import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { parseArgs, parseList } from '../../packages/editor/src/args.js';
import { commandId, type AgentEdit, type EditorCommand, type EditorResponse } from '../../packages/editor/src/protocol.js';
import { buildMcpServer } from '../../packages/editor/src/mcp.js';
import { listSceneFiles, type EditorBridge } from '../../packages/editor/src/server.js';
import { runCommand, type EditorHost } from '../../packages/editor/app/wsClient.js';
import type { EditorSession } from '../../packages/editor/app/session.js';

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
  return { sent, bridge: { connected: () => true, send: async (cmd) => { sent.push(cmd); return reply(cmd); }, push: () => {}, dispose: () => {} } };
}
async function connect(bridge: EditorBridge) {
  const server = buildMcpServer(bridge);
  const [serverEnd, clientEnd] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe('editor — MCP tools', () => {
  it('registers the editor toolset and relays a tool call, mapping a JSON result to text', async () => {
    const { bridge, sent } = stubBridge((cmd) => ({ id: cmd.id, ok: true, result: { kind: 'json', data: { id: 'ball', visible: true } } }));
    const { client, close } = await connect(bridge);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'edit_scene', 'get_preview', 'get_telemetry', 'open_file', 'playback', 'save_file', 'simulate',
    ]);

    const res = await client.callTool({ name: 'get_telemetry', arguments: { id: 'ball' } });
    expect(sent[0]).toMatchObject({ type: 'telemetry', targetId: 'ball' });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content[0]!.type).toBe('text');
    expect(content[0]!.text).toContain('"id": "ball"');
    await close();
  });

  it('relays edit/save commands to the host page and wraps the results as JSON', async () => {
    const session = {} as EditorSession; // edit/save never touch the session — they go to the host
    const host: EditorHost = {
      edit: (edits: AgentEdit[]) => ({ applied: edits.length, failed: [] }),
      save: async () => ({ changed: 2, unresolved: 0 }),
    };
    const edit = await runCommand(session, { id: 'x', type: 'edit', edits: [{ node: 'a', attr: 'visible', value: false }] }, host);
    expect(edit).toEqual({ kind: 'json', data: { applied: 1, failed: [] } });
    const save = await runCommand(session, { id: 'y', type: 'save' }, host);
    expect(save).toEqual({ kind: 'json', data: { changed: 2, unresolved: 0 } });
  });

  it('surfaces a "no editor connected" error', async () => {
    const bridge: EditorBridge = {
      connected: () => false,
      send: async () => { throw new Error('no editor connected — open the editor page in a browser first'); },
      push: () => {},
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
