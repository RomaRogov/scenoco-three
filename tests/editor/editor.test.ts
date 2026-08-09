import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { parseArgs, parseList } from '../../packages/editor/src/args.js';
import { commandId, type EditorCommand, type EditorResponse } from '../../packages/editor/src/protocol.js';
import { buildMcpServer } from '../../packages/editor/src/mcp.js';
import { listSceneFiles, readPort, rememberPort, startEditorServer, type EditorBridge } from '../../packages/editor/src/server.js';

describe('editor — CLI args + protocol', () => {
  it('parses positionals, value flags, and boolean flags; commandId is a short unique token', () => {
    const { positionals, options } = parseArgs(['scene.xml', '--components', 'a,b', '--verbose', '--port', '3000']);
    expect(positionals).toEqual(['scene.xml']);
    expect(options.components).toBe('a,b');
    expect(options.port).toBe('3000');
    expect('verbose' in options).toBe(true);
    expect(parseList('a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(commandId()).not.toBe(commandId());
  });
});

/** A bridge stub that records commands and returns canned replies. */
function stubBridge(reply: (cmd: EditorCommand) => EditorResponse): { bridge: EditorBridge; sent: EditorCommand[] } {
  const sent: EditorCommand[] = [];
  return { sent, bridge: { connected: () => true, send: async (cmd) => { sent.push(cmd); return reply(cmd); }, push: () => {}, waitForConnection: async () => true, dispose: () => {} } };
}
async function connect(bridge: EditorBridge) {
  const server = buildMcpServer(bridge);
  const [serverEnd, clientEnd] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

/** A valid capture format — every preview/simulate call has to state one. */
const FRAME = { width: 640, height: 360, fit: 'contain', ui: true } as const;

describe('editor — MCP tools', () => {
  it('registers the editor toolset and relays a tool call, mapping a JSON result to text', async () => {
    const { bridge, sent } = stubBridge((cmd) => ({ id: cmd.id, ok: true, result: { kind: 'json', data: { id: 'ball', visible: true } } }));
    const { client, close } = await connect(bridge);
    const { tools } = await client.listTools();
    // Observe-and-drive only — no scene-editing tools: the XML file is the single
    // source of truth, and an agent changes the game by editing it directly.
    expect(tools.map((t) => t.name).sort()).toEqual([
      'inspect', 'open_file', 'playback', 'screenshot', 'simulate',
    ]);

    const res = await client.callTool({ name: 'inspect', arguments: { id: 'ball' } });
    expect(sent[0]).toMatchObject({ type: 'telemetry', targetId: 'ball' });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content[0]!.type).toBe('text');
    expect(content[0]!.text).toContain('"id": "ball"');
    await close();
  });

  it('rejects a simulate preview step without an explicit camera framing', async () => {
    const { bridge, sent } = stubBridge((cmd) => ({ id: cmd.id, ok: true, result: { kind: 'ok' } }));
    const { client, close } = await connect(bridge);
    const res = await client.callTool({ name: 'simulate', arguments: { commands: [{ do: 'play' }, { do: 'preview' }], ...FRAME } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text?: string }>)[0]!.text).toContain('"camera"');
    expect(sent).toHaveLength(0); // rejected before reaching the editor
    await close();
  });

  // The capture format is stated once per command, never per shot: `screenshot`
  // takes it inline, `simulate` at the batch root so every preview in one run is
  // rendered identically. Both must reach the editor as the same `frame`.
  it('carries the capture format on the command — inline for a preview, once for a whole batch', async () => {
    const { bridge, sent } = stubBridge((cmd) => ({ id: cmd.id, ok: true, result: { kind: 'ok' } }));
    const { client, close } = await connect(bridge);

    await client.callTool({ name: 'screenshot', arguments: { camera: 'fit', ...FRAME } });
    expect(sent[0]).toMatchObject({ type: 'preview', camera: 'fit', frame: FRAME });

    await client.callTool({
      name: 'simulate',
      arguments: { commands: [{ do: 'preview', camera: 'fit' }, { do: 'preview', camera: '0 5 10' }], ...FRAME },
    });
    // One frame for the batch — the steps carry only their own framing.
    expect(sent[1]).toMatchObject({ type: 'simulate', frame: FRAME });
    expect((sent[1] as { steps: unknown[] }).steps).toEqual([
      { do: 'preview', camera: 'fit' },
      { do: 'preview', camera: '0 5 10' },
    ]);
    await close();
  });

  // Size, fit and UI are required, not defaulted: a capture rendered at some
  // ambient size with the HUD in an unknown state is one an agent cannot reason
  // about, and it is an agent that reads these pixels.
  it('refuses a capture that leaves its format unstated', async () => {
    const { bridge, sent } = stubBridge((cmd) => ({ id: cmd.id, ok: true, result: { kind: 'ok' } }));
    const { client, close } = await connect(bridge);
    for (const missing of ['width', 'height', 'fit', 'ui'] as const) {
      const args: Record<string, unknown> = { camera: 'fit', ...FRAME };
      delete args[missing];
      const res = await client.callTool({ name: 'screenshot', arguments: args });
      expect(res.isError, missing).toBe(true);
    }
    expect(sent).toHaveLength(0);
    await close();
  });

  it('surfaces a "no editor connected" error', async () => {
    const bridge: EditorBridge = {
      connected: () => false,
      send: async () => { throw new Error('no editor connected — open the editor page in a browser first'); },
      push: () => {},
      waitForConnection: async () => false,
      dispose: () => {},
    };
    const { client, close } = await connect(bridge);
    const res = await client.callTool({ name: 'playback', arguments: { state: 'play' } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text?: string }>)[0]!.text).toContain('no editor connected');
    await close();
  });
});

describe('listSceneFiles (start-up file picker)', () => {
  it('lists scenes/prefabs under the asset roots — kind-tagged, sorted, and isolated to the roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenoco-files-'));
    mkdirSync(join(dir, 'assets', 'scenes'), { recursive: true });
    mkdirSync(join(dir, 'assets', '.scenoco', 'component-cache'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'scenes', 'level.scene.xml'), '<Scene/>');
    writeFileSync(join(dir, 'assets', 'scenes', 'brick.prefab.xml'), '<Prefab/>');
    // Noise that must NOT appear: a cache artifact, a non-XML file, and a scene outside the roots.
    writeFileSync(join(dir, 'assets', '.scenoco', 'component-cache', 'a.scene.xml'), '<Scene/>');
    writeFileSync(join(dir, 'assets', 'notes.txt'), 'hi');
    writeFileSync(join(dir, 'src', 'stray.scene.xml'), '<Scene/>');

    expect(listSceneFiles(['assets'], dir)).toEqual([
      { file: 'assets/scenes/brick.prefab.xml', kind: 'prefab' },
      { file: 'assets/scenes/level.scene.xml', kind: 'scene' },
    ]);
    expect(listSceneFiles(['assets'], mkdtempSync(join(tmpdir(), 'scenoco-empty-')))).toEqual([]); // missing root
  });
});

// A component that swaps levels does `import('level_2.scene.xml?bundle')` at
// runtime. The editor loads the *open* file through its own `/@scenoco/bundle`
// HTTP endpoint, which left `?bundle` module ids unhandled — Vite served the raw
// XML and the import died on "invalid JS syntax", so level transitions and
// game-over restarts could not be playtested through `simulate` at all. The
// browser always requests a module import with `?import` appended, so that is
// the shape worth asserting.
describe('editor dev server — runtime ?bundle imports', () => {
  it('serves a scene bundle as a JS module, not raw XML', async () => {
    // An in-repo fixture, not a tmpdir: the emitted module imports the engine by
    // bare specifier, which only resolves from somewhere with node_modules above it.
    const dir = fileURLToPath(new URL('../fixtures/components-scene-import', import.meta.url));
    const scene = join(dir, 'level_2.scene.xml');

    const server = await startEditorServer({ cwd: dir, componentRoots: ['.'], port: 55998, idleMs: 10_000, initialGraceMs: 10_000 });
    try {
      const res = await fetch(`http://localhost:55998/@fs${scene}?import&bundle`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('javascript');
      expect(await res.text()).toContain('export default');
    } finally {
      await server.close();
    }
  }, 30_000);
});

describe('sticky editor port (.scenoco/editor-port)', () => {
  it('remembers the bound port and reads it back; rejects a missing or malformed file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenoco-port-'));
    expect(readPort(dir)).toBeUndefined(); // nothing remembered yet → fresh port
    rememberPort(dir, 51234);
    expect(readPort(dir)).toBe(51234); // reclaimed on the next launch
    writeFileSync(join(dir, '.scenoco', 'editor-port'), 'not-a-port');
    expect(readPort(dir)).toBeUndefined(); // garbage is ignored, not reused
  });
});
