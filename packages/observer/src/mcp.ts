import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AXIS_NAMES, BUTTON_NAMES, type Axis, type Button } from '@scenoco-three/core';
import type { ObserverCommand, ObserverResult, SimStep } from './protocol.js';
import type { ScenePage } from './browser.js';

/** `Omit` over each member of a union, rather than over what the members share. */
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * The MCP surface: **eyes, not hands.**
 *
 * Open a document, render it, drive it, read what happened. There is no tool here that writes to
 * the user's source, and that is a decision rather than an omission. An agent already has file
 * tools, and the observer's watcher rebuilds whatever it writes — so an edit tool would have
 * been a second write path into someone's project, one that never passed through the tools they
 * already have — their own editing, their diff, their undo. An agent holding one can reshape a scene while believing it is only looking at
 * it.
 *
 * v1 shipped `patch`, `structural` and `save` tools alongside these. They are deleted.
 *
 * The one thing worth insisting on: `simulate` exists because a screenshot of frame zero says
 * almost nothing about whether a game works. Drive it to the interesting moment, *then* look.
 */
export function createMcpServer(page: () => Promise<ScenePage>): McpServer {
  const mcp = new McpServer({ name: 'scenoco-observer', version: '0.6.0' });

  /** Every tool needs the page; the browser is launched on the first call that does. */
  const send = async (command: Without<ObserverCommand, 'id'>): Promise<ObserverResult> =>
    (await page()).call({ id: '', ...command } as ObserverCommand);

  // Every field has a default, so a first call needs nothing but a viewpoint. `ui` was required
  // once, and the first thing every agent did was fail on "expected boolean, received undefined".
  const frameSchema = {
    width: z.number().int().positive().default(800).describe('Captured image width in pixels'),
    height: z.number().int().positive().default(500).describe('Captured image height in pixels'),
    ui: z
      .boolean()
      .default(false)
      .describe('Include the screen-space UI layer, framing the shot through the camera that hosts it'),
  };

  const POINT =
    '"y: 6; z: 12" — the document\'s own vector grammar, an omitted axis being 0 — or an id with an ' +
    'optional offset, "#player" / "#player y: 6; z: 8", meaning that node\'s world position plus the offset';

  const viewpoint = {
    cameraPos: z.string().describe(`Where to look from: ${POINT}`),
    lookAt: z.string().optional().describe(`What to look at: ${POINT}. Defaults to the origin`),
    fov: z
      .number()
      .positive()
      .optional()
      .describe(
        'Vertical field of view in degrees — smaller is more zoomed in. Try 20 to look closely ' +
          'and 90 to take in a whole arena. Omit to keep the camera’s own. Not with `ui`: a UI ' +
          'capture is what the player sees, through the game camera’s lens.',
      ),
  };

  mcp.registerTool(
    'open',
    {
      description: 'Open a scene or prefab document in the observer page. Everything else needs one open.',
      inputSchema: { path: z.string().describe('Project-relative path, e.g. assets/scenes/main.scene.xml') },
    },
    async ({ path }) => text(await send({ type: 'open', path })),
  );

  mcp.registerTool(
    'screenshot',
    {
      description:
        'Render one PNG of the open scene from a stated viewpoint. `outline` is cheaper and exact; ' +
        'take a picture to check what a picture is for — layout, look, whether a thing is drawn.',
      inputSchema: { ...viewpoint, ...frameSchema },
    },
    async ({ cameraPos, lookAt, fov, width, height, ui }) =>
      image(
        await send({
          type: 'preview',
          cameraPos,
          ...(lookAt ? { lookAt } : {}),
          ...(fov !== undefined ? { fov } : {}),
          frame: { width, height, ui },
        }),
      ),
  );

  mcp.registerTool(
    'telemetry',
    {
      description:
        'Read the live state at an id — a node’s transform, visibility and each component’s fields ' +
        'and getters, or a component’s alone.',
      inputSchema: {
        id: z
          .string()
          .describe(
            'An id= from the open document, or one given at instantiate — with `/` for what is ' +
              'inside a spawned prefab: "slime3/body"',
          ),
      },
    },
    async ({ id }) => text(await send({ type: 'telemetry', targetId: id })),
  );

  mcp.registerTool(
    'outline',
    {
      description:
        'The scene as text: every node with its id, type, position and components, indented by ' +
        'depth, plus the systems and their values. The cheapest and most exact view there is — ' +
        'read this before taking a screenshot, and after a `simulate` to see what changed.',
      inputSchema: {
        id: z.string().optional().describe('Start at this node instead of the scene root'),
        depth: z.number().int().positive().optional().describe('How many levels down to show (default 4)'),
      },
    },
    async ({ id, depth }) =>
      text(
        await send({
          type: 'outline',
          ...(id ? { targetId: id } : {}),
          ...(depth !== undefined ? { depth } : {}),
        }),
      ),
  );

  for (const [name, type] of [
    ['play', 'run'],
    ['pause', 'pause'],
    ['stop', 'stop'],
  ] as const) {
    mcp.registerTool(
      name,
      { description: `${name[0]!.toUpperCase()}${name.slice(1)} the open scene.`, inputSchema: {} },
      async () => text(await send({ type })),
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
        // A real union rather than `record(unknown)`: a step is the one place a caller is most
        // likely to mistype, and an untyped bag means a wrong `do` or a misspelled field reaches
        // the page and does nothing rather than being refused here with the list of what exists.
        steps: z
          .array(
            z.discriminatedUnion('do', [
              z.object({ do: z.literal('play') }).describe('Start the scene running in real time'),
              z.object({ do: z.literal('pause') }).describe('Hold the scene where it is'),
              z.object({ do: z.literal('stop') }).describe('Reset the scene to its authored state'),
              z
                .object({
                  do: z.literal('step'),
                  frames: z.number().int().positive().optional().describe('Ticks to advance (default 1)'),
                  dt: z.number().positive().optional().describe('Seconds per tick (default 1/60)'),
                })
                .describe(
                  'Advance the scene by exact frames. After `pause` this is fully deterministic, ' +
                    'so numbers read back are reproducible; while `play` runs, wall-clock time ' +
                    'passes as well.',
                ),
              ...(['press', 'keyDown', 'keyUp'] as const).map((verb) =>
                z.object({
                  do: z.literal(verb),
                  key: z.string().describe('A KeyCode member name — "W", "Space", "LeftArrow"'),
                }),
              ),
              z
                .object({
                  do: z.literal('axis'),
                  axis: z.enum(AXIS_NAMES as [Axis, ...Axis[]]).describe('A Unity input axis'),
                  value: z
                    .number()
                    .nullable()
                    .describe('-1..1. Held until changed; null releases it back to the keys'),
                })
                .describe(
                  'Drive a named axis, which is what gameplay reads — `getAxis("Horizontal")`, ' +
                    'not A and D. Better than pressing keys when you want an exact value, and ' +
                    'the only way to reach code written for a joystick.',
                ),
              ...(['button', 'buttonDown', 'buttonUp'] as const).map((verb) =>
                z.object({
                  do: z.literal(verb),
                  button: z.enum(BUTTON_NAMES as [Button, ...Button[]]).describe('A Unity input button'),
                }),
              ),
              z.object({
                do: z.literal('click'),
                x: z.number().optional().describe('Canvas-relative pixels from the left'),
                y: z.number().optional().describe('Canvas-relative pixels from the top'),
                button: z.enum(['left', 'right', 'middle']).optional(),
              }),
              z.object({
                do: z.literal('move'),
                x: z.number().optional(),
                y: z.number().optional(),
                dx: z.number().optional(),
                dy: z.number().optional(),
              }),
              z
                .object({ do: z.literal('preview'), ...viewpoint })
                .describe('Capture a PNG. Size and UI come from this call, not the step.'),
              z
                .object({
                  do: z.literal('telemetry'),
                  id: z
                    .string()
                    .describe(
                      'An id= from the open document, or one given at instantiate — with `/` for ' +
                        'what is inside a spawned prefab: "slime3/body"',
                    ),
                })
                .describe('Sample a node and its components, or a component, by id'),
              z
                .object({
                  do: z.literal('outline'),
                  id: z.string().optional().describe('Start at this node instead of the scene root'),
                  depth: z.number().int().positive().optional().describe('Levels to show (default 4)'),
                })
                .describe('The scene, or the subtree under `id`, as text — what changed, exactly'),
              z
                .object({
                  do: z.literal('eval'),
                  code: z
                    .string()
                    .describe('JavaScript, run as the body of an async function against the live scene'),
                })
                .describe(
                  'Set up or read a situation in JavaScript. In scope: `scene`, `byId(path)`, ' +
                    '`find(TypeName)` and `findAll(TypeName)` (components, by class name), ' +
                    '`system(TypeName)`, `Time`, `Input`, `SceneManager`, `THREE`. Whatever you ' +
                    '`return` comes back as JSON. e.g. `byId("player").position.set(0, 1, 5)` — ' +
                    '`return findAll("Slime").map(s => s.object3D.position.toArray())` — ' +
                    '`return system("GameState").score`. It touches only the running scene, ' +
                    'never a file, and `stop` discards all of it.',
                ),
            ]),
          )
          .describe(
            'Ordered steps; only `preview`, `telemetry`, `outline` and `eval` produce output. Size and UI are set ' +
              'once for the whole batch, so two shots of one run stay comparable.',
          ),
        ...frameSchema,
      },
    },
    async ({ steps, width, height, ui }) => {
      const result = await send({
        type: 'simulate',
        steps,
        frame: { width, height, ui },
      });
      if (result.kind !== 'multi') return text(result);
      // Images and readings interleaved in the order they were captured, so a caller can line a
      // frame up with the numbers that went with it.
      return {
        content: result.results.map((one) =>
          one.kind === 'image'
            ? { type: 'image' as const, data: one.dataUrl.split(',')[1] ?? '', mimeType: 'image/png' }
            : one.kind === 'text'
              ? { type: 'text' as const, text: one.text }
              : { type: 'text' as const, text: JSON.stringify(one.kind === 'json' ? one.data : one, null, 2) },
        ),
      };
    },
  );

  return mcp;
}

function text(result: ObserverResult): { content: Array<{ type: 'text'; text: string }> } {
  const body =
    result.kind === 'json'
      ? JSON.stringify(result.data, null, 2)
      : result.kind === 'text'
        ? result.text
        : result.kind === 'ok'
        ? (result.info ?? 'ok')
        : JSON.stringify(result);
  return { content: [{ type: 'text', text: body }] };
}

function image(
  result: ObserverResult,
): { content: Array<{ type: 'image'; data: string; mimeType: string }> } {
  if (result.kind !== 'image') throw new Error('the observer did not return an image');
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
      // A client routinely outlives the server it initialized against: the observer exits when
      // its client hangs up, and the next `scenoco-observer` is a new process holding none of the
      // old sessions. The protocol has one answer for a session id the server does not
      // know — 404, on receipt of which a client must open a new session — and any other answer
      // strands it. A JSON-RPC error inside a 200 in particular reads as a live server refusing
      // the call, so the client keeps the dead id and every tool call after a restart fails.
      const stale = typeof id === 'string';
      res.statusCode = stale ? 404 : 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: stale
              ? 'no such session — the observer restarted; initialize again'
              : 'unknown session — send `initialize` first',
          },
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

/**
 * Serve the MCP over stdio — the transport an MCP client spawns a server with.
 *
 * The default, because it needs no port and no configuration beyond the command: the client
 * starts `scenoco-observer` in the project, talks to it on stdin/stdout, and ends it when the
 * session ends. Everything else this process prints goes to stderr, and the dev server is told
 * to be quiet, because one stray line on stdout is a broken session.
 */
export async function startMcpStdio(server: McpServer, onClose: () => void): Promise<void> {
  const transport = new StdioServerTransport();
  transport.onclose = onClose;
  await server.connect(transport);
}
