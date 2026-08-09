import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CAMERA_FIT_MODES, VEC3_FORMAT } from '@scenoco-three/core';
import { commandId, type EditorCommand, type EditorResult, type PreviewFrame, type SimStep } from './protocol.js';
import type { EditorBridge } from './server.js';

/**
 * How a point is written in every capture input. Built from the DSL's own
 * `VEC3_FORMAT` rather than spelled out here, so the tool schema and the scene XML
 * can't come to describe a vec3 differently — the agent writing `position="y: 6;
 * z: 12"` in a scene should not have to learn a second grammar to point a camera
 * at it. The positional form stays accepted, as it does in the XML.
 */
const VEC_HINT = `("${VEC3_FORMAT.example}" — an omitted axis is 0; the positional "${VEC3_FORMAT.positional}" also works)`;

/**
 * The capture-format inputs, shared verbatim by `screenshot` and `simulate` —
 * one definition, so the two can never drift into describing the same frame
 * differently. All required: a capture whose size or UI state was left to a
 * default is a screenshot nobody can reason about, and the caller is usually an
 * agent that will read pixels and draw conclusions from them.
 */
const frameSchema = {
  width: z.number().int().positive().describe('Captured image width in pixels'),
  height: z.number().int().positive().describe('Captured image height in pixels'),
  fit: z
    .enum(CAMERA_FIT_MODES)
    .describe(
      "How the rendering camera adapts to this frame's aspect, against its authored designWidth/designHeight " +
        "(the <Camera fit=…> modes). 'none' = use the camera exactly as authored; 'contain' = keep the whole design " +
        "region visible; 'cover' = fill the frame, cropping outside it; 'width'/'height' = hold that axis. A camera " +
        'with no design size has nothing to adapt to, so any mode leaves it unchanged.',
    ),
  ui: z
    .boolean()
    .describe(
      'Include the screen-space UI layer (a <Fullscreen> HUD and anything else parented to a camera). When the shot ' +
        'is framed by a camera other than the scene\'s own, the layer is re-hosted on the capture camera and laid out ' +
        'again, so the HUD appears where the player would see it. false leaves it out — use that to inspect geometry ' +
        'a HUD covers.',
    ),
};

/** Pull the frame settings out of a validated tool input. */
const toFrame = (a: { width: number; height: number; fit: PreviewFrame['fit']; ui: boolean }): PreviewFrame => ({
  width: a.width,
  height: a.height,
  fit: a.fit,
  ui: a.ui,
});

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
    'screenshot',
    {
      description:
        'Capture the current editor view as a PNG from an explicit camera framing — pick the angle that shows ' +
        'what you are checking (top-down for layout, behind-the-player for gameplay, "fit" for an overview). ' +
        'The output format (size, camera fit, whether the UI is in the shot) is stated per call, so a capture is ' +
        'never at some ambient default you did not choose.',
      inputSchema: {
        camera: z.string().describe(`Camera position, in the scene DSL's vector grammar ${VEC_HINT} — or "fit" to auto-frame the whole scene`),
        lookAt: z.string().optional().describe(`Look-at point ${VEC_HINT} (default: scene center; ignored when camera is "fit")`),
        ...frameSchema,
      },
    },
    (args) => relay({ id: commandId(), type: 'preview', camera: args.camera, ...(args.lookAt ? { lookAt: args.lookAt } : {}), frame: toFrame(args) }),
  );
  server.registerTool(
    'playback',
    {
      description: 'Control gameplay: play (run components/systems/physics), pause, or stop (back to edit mode).',
      inputSchema: { state: z.enum(['play', 'pause', 'stop']) },
    },
    ({ state }) => relay({ id: commandId(), type: state === 'play' ? 'run' : state }),
  );
  server.registerTool(
    'inspect',
    {
      description:
        'Read the current property values (JSON) at a scene id. Nodes and components share one id namespace, so `id` may be ' +
        'either: a node id returns its transform plus every component on it; a component id returns that component ' +
        "alone plus its host node's transform. Values shown are the @property fields — plain runtime fields are not " +
        'part of a component\'s declared surface and do not appear. An id that no longer resolves means the thing was ' +
        'destroyed, which is a useful assertion in itself. Every reading carries `frame` (frames ticked) and `time` ' +
        '(simulated seconds), so a reading can be tied to the point in the run that produced it.',
      inputSchema: { id: z.string() },
    },
    ({ id }) => relay({ id: commandId(), type: 'telemetry', targetId: id }),
  );

  // Deliberately no scene-editing tools: the XML file is the single source of
  // truth, and an agent changes the game by editing it (then the editor hot-reloads).
  // The MCP surface only observes and drives: open/preview/playback/telemetry/simulate.

  // A simulation command — one entry in the `simulate` batch. Loose (all fields
  // optional) so the agent composes any step; only `do` is required.
  const simStep = z.object({
    do: z.enum(['play', 'pause', 'stop', 'step', 'press', 'keyDown', 'keyUp', 'click', 'move', 'gamepad', 'preview', 'telemetry']),
    key: z.string().optional().describe("press/keyDown/keyUp: KeyCode member name, e.g. 'Space', 'W', 'LeftArrow'"),
    frames: z.number().int().optional(),
    dt: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    dx: z.number().optional(),
    dy: z.number().optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    index: z.number().int().optional(),
    buttons: z.array(z.boolean()).optional(),
    axes: z.array(z.number()).optional(),
    camera: z.string().optional().describe(`preview: camera position ${VEC_HINT}, or "fit" to auto-frame — required on preview steps`),
    lookAt: z.string().optional().describe(`preview: look-at point ${VEC_HINT} (default: scene center)`),
    id: z.string().optional(),
  });
  server.registerTool(
    'simulate',
    {
      description:
        'Drive gameplay: an ordered batch of steps; returns previews (images) and telemetry (JSON) in order. ' +
        'Each step is one self-contained verb: { do: "play"|"pause"|"stop" | "step"(frames) | "press"(key) | ' +
        '"keyDown"(key) | "keyUp"(key) | "click"(x,y,button) | "move"(x,y,dx,dy) | "preview"(camera,lookAt) | "telemetry"(id) }. ' +
        'Example: [{do:"play"},{do:"press",key:"Space"},{do:"step",frames:90},{do:"preview",camera:"fit"}]. ' +
        'Captures come back as one flat ordered list; each telemetry reading carries `frame` and `time`, so sampling ' +
        'the same id before and after a `step` shows what changed and over how many frames. ' +
        'The capture format (width/height/fit/ui) is stated once for the whole batch, not per preview step — every ' +
        'shot of one run is then rendered identically, so what differs between two of them is the run, not the setup.',
      inputSchema: { commands: z.array(simStep), ...frameSchema },
    },
    ({ commands, ...frame }) => {
      // The step schema is loose (fields shared across verbs), so the one required
      // field is enforced here: a preview without an explicit framing is an error.
      const bad = commands.findIndex((c) => c.do === 'preview' && !c.camera);
      if (bad !== -1) {
        return Promise.resolve({
          isError: true as const,
          content: [{ type: 'text' as const, text: `simulate: preview step #${bad} needs "camera" — a position ${VEC_HINT}, or "fit" to auto-frame the scene` }],
        });
      }
      return relay({ id: commandId(), type: 'simulate', steps: commands as SimStep[], frame: toFrame(frame) });
    },
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

type ContentBlock = { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string };

function toContent(result: EditorResult): { content: ContentBlock[] } {
  switch (result.kind) {
    case 'image': {
      const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '');
      return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] };
    }
    case 'json':
      return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
    case 'multi': {
      // Flatten each capture's blocks, preserving step order.
      const content = result.results.flatMap((r) => toContent(r).content);
      return { content: content.length > 0 ? content : [{ type: 'text', text: 'ok' }] };
    }
    case 'ok':
    default:
      return { content: [{ type: 'text', text: result.info ?? 'ok' }] };
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
