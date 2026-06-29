import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { parseArgs, parseList } from '../packages/editor/src/args.js';
import { commandId, type EditorCommand, type EditorResponse } from '../packages/editor/src/protocol.js';
import { buildMcpServer } from '../packages/editor/src/mcp.js';
import type { EditorBridge } from '../packages/editor/src/server.js';

describe('editor — CLI args + protocol', () => {
  it('parses positionals, value flags, and boolean flags', () => {
    const { positionals, options } = parseArgs(['scene.xml', '--components', 'a,b', '--no-open', '--port', '3000']);
    expect(positionals).toEqual(['scene.xml']);
    expect(options.components).toBe('a,b');
    expect(options.port).toBe('3000');
    expect('no-open' in options).toBe(true);
    expect(parseList('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('commandId is a short, unique token', () => {
    const a = commandId();
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(a).not.toBe(commandId());
  });
});

/** A bridge stub that records commands and returns canned replies. */
function stubBridge(reply: (cmd: EditorCommand) => EditorResponse): { bridge: EditorBridge; sent: EditorCommand[] } {
  const sent: EditorCommand[] = [];
  return {
    sent,
    bridge: {
      connected: () => true,
      send: async (cmd) => {
        sent.push(cmd);
        return reply(cmd);
      },
      push: () => {},
    },
  };
}

async function connect(bridge: EditorBridge) {
  const server = buildMcpServer(bridge);
  const [serverEnd, clientEnd] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('editor — MCP tools', () => {
  it('registers the editor toolset', async () => {
    const { client, close } = await connect(stubBridge(() => ({ id: 'x', ok: true, result: { kind: 'ok' } })).bridge);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_preview', 'get_telemetry', 'open_file', 'playback', 'simulate']);
    await close();
  });

  it('relays a tool call and maps a JSON result to text content', async () => {
    const { bridge, sent } = stubBridge((cmd) => ({ id: cmd.id, ok: true, result: { kind: 'json', data: { id: 'ball', visible: true } } }));
    const { client, close } = await connect(bridge);
    const res = await client.callTool({ name: 'get_telemetry', arguments: { id: 'ball' } });
    expect(sent[0]).toMatchObject({ type: 'telemetry', targetId: 'ball' });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content[0]!.type).toBe('text');
    expect(content[0]!.text).toContain('"id": "ball"');
    await close();
  });

  it('maps an image result to image content', async () => {
    const { bridge } = stubBridge((cmd) => ({ id: cmd.id, ok: true, result: { kind: 'image', dataUrl: 'data:image/png;base64,QUJD' } }));
    const { client, close } = await connect(bridge);
    const res = await client.callTool({ name: 'get_preview', arguments: {} });
    const content = res.content as Array<{ type: string; data?: string; mimeType?: string }>;
    expect(content[0]).toMatchObject({ type: 'image', data: 'QUJD', mimeType: 'image/png' });
    await close();
  });

  it('surfaces a "no editor connected" error', async () => {
    const bridge: EditorBridge = {
      connected: () => false,
      send: async () => {
        throw new Error('no editor connected — open the editor page in a browser first');
      },
      push: () => {},
    };
    const { client, close } = await connect(bridge);
    const res = await client.callTool({ name: 'playback', arguments: { state: 'play' } });
    expect(res.isError).toBe(true);
    const content = res.content as Array<{ text?: string }>;
    expect(content[0]!.text).toContain('no editor connected');
    await close();
  });
});
