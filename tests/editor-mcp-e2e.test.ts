import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startEditorServer, type EditorServer } from '../packages/editor/src/server.js';
import { startMcpServer, type McpHandle } from '../packages/editor/src/mcp.js';
import { WS_PATH, type EditorCommand, type EditorResponse } from '../packages/editor/src/protocol.js';
import { EditorSession } from '../packages/editor/app/session.js';
import { runCommand } from '../packages/editor/app/wsClient.js';

/**
 * End-to-end exercise of the editor's MCP surface, with every layer real:
 *
 *   MCP client (Streamable HTTP)
 *     → real `startMcpServer` tools
 *       → real WS bridge (`startEditorServer`)
 *         → a Node "editor" running the **real** `EditorSession` + `runCommand`
 *           → real headless `Engine` (loadScene / findObject / @property values)
 *
 * The single thing that can't run in Node is the GPU draw, so after each engine
 * swap we replace `renderer.render` with a no-op (the WebGLRenderer still
 * constructs against a stub canvas; `toDataURL` returns a real PNG). Everything
 * the MCP tools actually relay — compile-on-open, scene/prefab loading, mode
 * transitions, and telemetry JSON — is the production code path.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const scenePath = resolve(root, 'examples/breakout/scenes/breakout.scene.xml');
const prefabPath = resolve(root, 'examples/breakout/scenes/brick.prefab.xml');

// A 1x1 transparent PNG — what the stub canvas hands back for a "preview".
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A minimal canvas + GL context: enough for WebGLRenderer to *construct*. */
function stubCanvas(): HTMLCanvasElement {
  const gl = new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'getParameter') return () => '';
        if (p === 'getExtension') return () => null;
        if (p === 'getShaderPrecisionFormat') return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
        if (p === 'getContextAttributes') return () => ({});
        return () => 0;
      },
    },
  );
  return {
    width: 320,
    height: 240,
    clientWidth: 320,
    clientHeight: 240,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getContext: (type: string) => (type.startsWith('webgl') ? gl : null),
    toDataURL: () => PNG_1x1,
  } as unknown as HTMLCanvasElement;
}

let editor: EditorServer;
let mcp: McpHandle;
let ws: WebSocket;
let session: EditorSession;
let client: Client;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  // 1. Real editor dev server: WS bridge + on-demand bundle compile. `cwd` +
  //    componentRoots/packages register the breakout components and Box2D tags
  //    in this process so the scene compiles and instantiates.
  editor = await startEditorServer({
    cwd: root,
    componentRoots: ['examples/breakout/components'],
    packages: ['@scenoco-three/box2d'],
  });
  mcp = await startMcpServer(editor.bridge);

  // `session.open` fetches the bundle with a root-relative URL (browser origin);
  // in Node, resolve those against the editor server.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) input = new URL(input, editor.url).href;
    return realFetch(input as RequestInfo | URL, init);
  }) as typeof fetch;

  // 2. The "editor page": a real EditorSession driven by the real command
  //    dispatch. Neutralise the GPU draw after every engine swap.
  session = new EditorSession(stubCanvas());
  const neutralizeRender = (): void => {
    const r = session.engine.renderer as { render: () => void } | undefined;
    if (r) r.render = () => {};
  };
  neutralizeRender();
  session.onChange = neutralizeRender;

  const wsUrl = `ws://${new URL(editor.url).host}${WS_PATH}`;
  ws = new WebSocket(wsUrl);
  ws.on('message', async (data) => {
    const cmd = JSON.parse(String(data)) as EditorCommand;
    let response: EditorResponse;
    try {
      response = { id: cmd.id, ok: true, result: await runCommand(session, cmd) };
    } catch (e) {
      response = { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    ws.send(JSON.stringify(response));
  });
  await new Promise<void>((res, rej) => {
    ws.on('open', () => res());
    ws.on('error', rej);
  });

  // 3. A real MCP client over Streamable HTTP.
  client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url)));
}, 30_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await client?.close();
  ws?.close();
  await mcp?.close();
  await editor?.close();
});

/** Call a tool and return its first content block. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  return { res, content, first: content[0]! };
}
/** Parse a JSON tool result (open_file / get_telemetry return text JSON). */
function json(text?: string): any {
  return JSON.parse(text ?? '');
}

describe('editor MCP — end to end (real server + bridge + session + engine)', () => {
  it('1. open_file loads a scene, then swaps to a prefab', async () => {
    const scene = await call('open_file', { path: scenePath });
    expect(scene.res.isError).toBeFalsy();
    const s = json(scene.first.text);
    expect(s).toMatchObject({ file: scenePath, kind: 'scene' });
    expect(s.nodes).toBeGreaterThan(10); // walls, paddle, ball, 12 bricks, …
    expect(session.mode).toBe('edit');

    const prefab = await call('open_file', { path: prefabPath });
    expect(prefab.res.isError).toBeFalsy();
    expect(json(prefab.first.text)).toMatchObject({ kind: 'prefab' });

    // Re-open the scene so later cases run against it.
    await call('open_file', { path: scenePath });
  });

  it('2. get_preview returns a PNG image, optionally re-framed by camera/lookAt', async () => {
    const plain = await call('get_preview');
    expect(plain.first).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(plain.first.data && plain.first.data.length).toBeGreaterThan(0);

    // Re-framing the editor camera must move it to the requested from/to.
    await call('get_preview', { camera: '0 3 25', lookAt: '0 7 0' });
    expect(session.editorCamera?.position.toArray()).toEqual([0, 3, 25]);
  });

  it('3. run / pause / stop drive the play↔edit lifecycle', async () => {
    const run = await call('run');
    expect(run.first.text).toBe('playing');
    expect(session.mode).toBe('play');
    expect(session.playing).toBe(true);

    const pause = await call('pause');
    expect(pause.first.text).toBe('paused');
    expect(session.mode).toBe('play');
    expect(session.playing).toBe(false);

    const stop = await call('stop');
    expect(stop.first.text).toBe('edit mode');
    expect(session.mode).toBe('edit');
    expect(session.playing).toBe(false);
  });

  it('4. get_telemetry returns transform + component @property values by id', async () => {
    const ball = json((await call('get_telemetry', { id: 'ball' })).first.text);
    expect(ball.id).toBe('ball');
    expect(ball.transform.position).toEqual([0, 1.1, 0]);
    // Real @property values off the live Ball + Box2D components.
    expect(Object.keys(ball.components)).toEqual(expect.arrayContaining(['Ball', 'RigidBody2D', 'Collider2D']));
    expect(ball.components.Ball.launchSpeed).toBe(12);
    expect(ball.components.Ball.lives).toBe(3);
    expect(ball.components.Ball.bounceSpeeds).toEqual([8, 12, 16]);

    const missing = json((await call('get_telemetry', { id: 'does-not-exist' })).first.text);
    expect(missing.error).toContain('no object');
  });
});
