import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { commandId, type EditorCommand, type EditorResult } from './protocol.js';
import type { EditorBridge } from './server.js';

export interface McpHandle {
  /** The MCP endpoint URL to add to an MCP client. */
  url: string;
  close(): Promise<void>;
}

/**
 * Start a stateless MCP server (Streamable HTTP) whose tools relay to the live
 * editor over `bridge`. A fresh `McpServer` + transport is built per request.
 */
export async function startMcpServer(bridge: EditorBridge, opts: { port?: number } = {}): Promise<McpHandle> {
  const port = opts.port ?? (await freePort());
  const http = createHttpServer((req, res) => void handle(req, res, bridge));
  await new Promise<void>((resolve) => http.listen(port, resolve));
  return {
    url: `http://localhost:${port}/mcp`,
    close: () => new Promise((resolve) => http.close(() => resolve())),
  };
}

/** Build an McpServer whose tools relay to the editor. */
export function buildMcpServer(bridge: EditorBridge): McpServer {
  const server = new McpServer({ name: 'scenoco-editor', version: '0.1.0' });
  const relay = (cmd: EditorCommand) => relayToEditor(bridge, cmd);

  server.registerTool(
    'open_file',
    { description: 'Open a scene (.scene.xml) or prefab (.prefab.xml) in the editor (edit mode).', inputSchema: { path: z.string() } },
    ({ path }) => relay({ id: commandId(), type: 'open', path }),
  );
  server.registerTool(
    'get_preview',
    {
      description: 'Capture the current editor view as a PNG. Optionally frame a specific camera.',
      inputSchema: {
        camera: z.string().optional().describe('Camera position "x y z"'),
        lookAt: z.string().optional().describe('Look-at point "x y z"'),
      },
    },
    ({ camera, lookAt }) =>
      relay({ id: commandId(), type: 'preview', ...(camera ? { camera } : {}), ...(lookAt ? { lookAt } : {}) }),
  );
  server.registerTool('run', { description: 'Start gameplay (play mode): runs components, systems and physics.' }, () => relay({ id: commandId(), type: 'run' }));
  server.registerTool('pause', { description: 'Pause gameplay, freezing the current state.' }, () => relay({ id: commandId(), type: 'pause' }));
  server.registerTool('stop', { description: 'Stop gameplay and return to the authored scene (edit mode).' }, () => relay({ id: commandId(), type: 'stop' }));
  server.registerTool(
    'get_telemetry',
    { description: 'Current property values (JSON) for the node/components at a scene id.', inputSchema: { id: z.string() } },
    ({ id }) => relay({ id: commandId(), type: 'telemetry', targetId: id }),
  );

  return server;
}

/** Send a command to the editor and map its reply to MCP tool content. */
async function relayToEditor(bridge: EditorBridge, cmd: EditorCommand) {
  let response;
  try {
    response = await bridge.send(cmd);
  } catch (e: unknown) {
    return { isError: true as const, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] };
  }
  if (!response.ok) return { isError: true as const, content: [{ type: 'text' as const, text: response.error }] };
  return toContent(response.result);
}

function toContent(result: EditorResult) {
  switch (result.kind) {
    case 'image': {
      const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '');
      return { content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' }] };
    }
    case 'json':
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
    case 'ok':
    default:
      return { content: [{ type: 'text' as const, text: result.info ?? 'ok' }] };
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, bridge: EditorBridge): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if ((req.url ?? '').split('?')[0] !== '/mcp') {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end(JSON.stringify({ error: 'this MCP endpoint is stateless — use POST' }));
    return;
  }

  const body = await readJson(req);
  // Stateless: a fresh server + transport per request.
  const server = buildMcpServer(bridge);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createNetServer();
    probe.on('error', rej);
    probe.listen(0, () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => res(port));
    });
  });
}
