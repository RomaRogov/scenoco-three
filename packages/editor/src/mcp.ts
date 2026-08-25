import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { commandId, type EditorResult, type SimStep } from './protocol.js';
import type { EditorBridge } from './server.js';

/**
 * The MCP surface: **eyes, not hands.**
 *
 * Open a document, render it, drive it, read what happened. There is no tool here that writes to
 * the user's source, and that is a decision rather than an omission. An agent already has file
 * tools, and the editor's watcher rebuilds whatever it writes — so an edit tool would have been
 * a second write path into someone's project that never passed through their editor, their diff
 * or their undo. An agent holding one can reshape a scene while believing it is only looking at
 * it.
 *
 * v1 shipped `patch`, `structural` and `save` tools alongside these. They are deleted.
 *
 * The one thing worth insisting on: `simulate` exists because a screenshot of frame zero says
 * almost nothing about whether a game works. Drive it to the interesting moment, *then* look.
 */
export function createMcpServer(bridge: EditorBridge, editorUrl: () => string): McpServer {
  const mcp = new McpServer({ name: 'scenoco-editor', version: '2.0.0' });

  /** Every tool needs a live page; saying so plainly beats a timeout. */
  const send = async (command: Parameters<EditorBridge['send']>[0]): Promise<EditorResult> => {
    if (!bridge.connected()) {
      throw new Error(`no editor page is open — visit ${editorUrl()} first, then retry`);
    }
    const response = await bridge.send(command);
    if (!response.ok) throw new Error(response.error);
    return response.result;
  };

  const frameSchema = {
    width: z.number().int().positive().describe('Captured image width in pixels'),
    height: z.number().int().positive().describe('Captured image height in pixels'),
    ui: z
      .boolean()
      .describe('Include the screen-space UI layer, framing the shot through the camera that hosts it'),
  };

  const POINT = '"y: 6; z: 12" — the document\'s own vector grammar; an omitted axis is 0';

  mcp.registerTool(
    'open',
    {
      description: 'Open a scene or prefab document in the editor page.',
      inputSchema: { path: z.string().describe('Project-relative path, e.g. assets/scenes/main.scene.xml') },
    },
    async ({ path }) => text(await send({ id: commandId(), type: 'open', path })),
  );

  mcp.registerTool(
    'screenshot',
    {
      description:
        'Render one PNG of the open scene from a given viewpoint. Does not move the editor camera.',
      inputSchema: {
        camera: z.string().describe(`Where to look from: ${POINT}, or "fit" to frame the whole scene`),
        lookAt: z.string().optional().describe(`What to look at: ${POINT}. Defaults to the origin`),
        ...frameSchema,
      },
    },
    async ({ camera, lookAt, width, height, ui }) =>
      image(
        await send({
          id: commandId(),
          type: 'preview',
          camera,
          ...(lookAt ? { lookAt } : {}),
          frame: { width, height, ui },
        }),
      ),
  );

  mcp.registerTool(
    'telemetry',
    {
      description:
        'Read the live state at an id the document declares — transform, visibility, and each component’s public values.',
      inputSchema: { id: z.string().describe('An id= from the open document') },
    },
    async ({ id }) => text(await send({ id: commandId(), type: 'telemetry', targetId: id })),
  );

  for (const [name, type] of [
    ['play', 'run'],
    ['pause', 'pause'],
    ['stop', 'stop'],
  ] as const) {
    mcp.registerTool(
      name,
      { description: `${name[0]!.toUpperCase()}${name.slice(1)} the open scene.`, inputSchema: {} },
      async () => text(await send({ id: commandId(), type })),
    );
  }

  mcp.registerTool(
    'simulate',
    {
      description:
        'Run a batch of steps against the live scene and collect what each produced. This is how ' +
        'to find out whether a game works: drive it to the moment that matters, then capture. ' +
        'Steps run in order.',
      inputSchema: {
        steps: z
          .array(z.record(z.string(), z.unknown()))
          .describe(
            'Ordered steps. {"do":"play"} · {"do":"step","frames":30,"dt":0.0167} · ' +
              '{"do":"press","key":"Space"} (a KeyCode member name) · {"do":"keyDown"/"keyUp","key":…} · ' +
              '{"do":"click","x":100,"y":80} · {"do":"move","x":…,"y":…} · ' +
              `{"do":"preview","camera":${JSON.stringify(POINT)}} · {"do":"telemetry","id":"ball"}`,
          ),
        ...frameSchema,
      },
    },
    async ({ steps, width, height, ui }) => {
      const result = await send({
        id: commandId(),
        type: 'simulate',
        steps: steps as unknown as SimStep[],
        frame: { width, height, ui },
      });
      if (result.kind !== 'multi') return text(result);
      // Images and readings interleaved in the order they were captured, so a caller can line a
      // frame up with the numbers that went with it.
      return {
        content: result.results.map((one) =>
          one.kind === 'image'
            ? { type: 'image' as const, data: one.dataUrl.split(',')[1] ?? '', mimeType: 'image/png' }
            : { type: 'text' as const, text: JSON.stringify(one.kind === 'json' ? one.data : one, null, 2) },
        ),
      };
    },
  );

  return mcp;
}

function text(result: EditorResult): { content: Array<{ type: 'text'; text: string }> } {
  const body =
    result.kind === 'json'
      ? JSON.stringify(result.data, null, 2)
      : result.kind === 'ok'
        ? (result.info ?? 'ok')
        : JSON.stringify(result);
  return { content: [{ type: 'text', text: body }] };
}

function image(
  result: EditorResult,
): { content: Array<{ type: 'image'; data: string; mimeType: string }> } {
  if (result.kind !== 'image') throw new Error('the editor did not return an image');
  return {
    content: [{ type: 'image', data: result.dataUrl.split(',')[1] ?? '', mimeType: 'image/png' }],
  };
}

/**
 * Serve the MCP over HTTP on a fixed port.
 *
 * Fixed on purpose: an MCP client is configured once with a URL, and a port that moved on every
 * restart would need reconfiguring every time.
 *
 * **One transport per session**, created when a client initializes and kept until it goes away.
 * A single shared transport looked simpler and allowed exactly one client ever: the first
 * `initialize` claimed it, and every later one — a reconnect, a second client, a restarted
 * agent — got a bare `400`, which reads like a crashed server rather than a design limit.
 */
export async function startMcpHttp(
  makeServer: () => McpServer,
  port: number,
): Promise<{ close(): Promise<void> }> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const http = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error instanceof Error ? error.message : error));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = req.headers['mcp-session-id'];
    const existing = typeof id === 'string' ? sessions.get(id) : undefined;
    if (existing) return existing.handleRequest(req, res, await body(req));

    const parsed = await body(req);
    if (!isInitialize(parsed)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'unknown session — send `initialize` first' },
        }),
      );
      return;
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (session: string): void => {
        sessions.set(session, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await makeServer().connect(transport);
    return transport.handleRequest(req, res, parsed);
  }

  await new Promise<void>((done) => http.listen(port, done));

  return {
    close: async () => {
      for (const transport of sessions.values()) await transport.close().catch(() => {});
      sessions.clear();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

function isInitialize(parsed: unknown): boolean {
  return typeof parsed === 'object' && parsed !== null && (parsed as { method?: string }).method === 'initialize';
}

/** The request body, read once — the transport is handed the parsed value rather than the stream. */
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}
