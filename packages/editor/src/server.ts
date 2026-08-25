import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import { WebSocketServer } from 'ws';
import {
  build,
  findAssets,
  formatDiagnostic,
  indexDocument,
  insertChild,
  moveElement,
  removeElement,
  setAttribute,
  type ElementAt,
  type ProjectModel,
} from '@scenoco-three/compiler';
import { WS_PATH, type EditorCommand, type EditorPush, type EditorResponse } from './protocol.js';

export interface ServerOptions {
  /** Project root — the directory holding `tsconfig.json` and `assets/`. Defaults to cwd. */
  root?: string;
  /** Packages whose tags the documents may use, beyond `three`. */
  modules?: readonly string[];
  /** Fixed port. Defaults to a free one the OS picks. */
  port?: number;
  /**
   * Called when no editor page has been connected for a while — none ever connected within
   * `initialGraceMs`, or the last one disconnected and none came back within `idleMs`.
   *
   * Opt-in, so an embedder or a test stays long-lived. The CLI wires it to a graceful shutdown,
   * which is what keeps a closed tab from leaving an editor process running for the rest of the
   * day.
   */
  onIdle?: () => void;
  idleMs?: number;
  initialGraceMs?: number;
}

/** Relays a command to the connected editor page and awaits its reply. */
export interface EditorBridge {
  connected(): boolean;
  send(command: EditorCommand): Promise<EditorResponse>;
  push(message: EditorPush): void;
  /**
   * Resolve as soon as an editor page is connected, or `false` after `ms`.
   *
   * The CLI waits on this after reclaiming the previous session's port: a tab stranded by an
   * ungraceful exit is still retrying its socket every second, so giving it a moment to come
   * back is the difference between reusing the tab and stacking up a new one.
   */
  waitForConnection(ms: number): Promise<boolean>;
}

export interface EditorServer {
  url: string;
  /**
   * The same editor, reachable from another device on the network — a phone, for testing touch.
   *
   * Absent when the host has no LAN interface to offer.
   */
  networkUrl?: string;
  port: number;
  /**
   * True when this server bound the **previous** session's port rather than a fresh one, so any
   * tab left over from that session is about to reattach on its own retry loop.
   */
  reusedPort: boolean;
  bridge: EditorBridge;
  /** What the project's TypeScript declares — the inspector's schema. */
  model(): ProjectModel;
  close(): Promise<void>;
}

const appRoot = fileURLToPath(new URL('../app', import.meta.url));

/**
 * The editor's own dev server.
 *
 * It serves the editor page from this package and lets it import the **project's** generated
 * modules over `/@fs`, which is the arrangement decided when this was ported: riding the
 * project's own Vite would put a React app inside the game's build.
 *
 * Its jobs are few. Compile the project **with provenance** so the page can map a mesh back to
 * the element that built it. Serve the model and the document text the inspector needs. Take a
 * save and splice it into the source. Watch, rebuild, and tell the page.
 */
export async function startEditorServer(options: ServerOptions = {}): Promise<EditorServer> {
  const root = resolve(options.root ?? process.cwd());
  let model: ProjectModel | undefined;

  /** Compile the project. Provenance is always on here — that is what an editor is. */
  const compile = (rescan: boolean): { ok: true } | { ok: false; message: string } => {
    if (rescan) model = undefined;
    const result = build({
      root,
      // No list means the project's own dependencies decide, which is what `build` does with
      // an absent `modules` — the editor must accept exactly what `vite dev` accepts.
      ...(options.modules ? { modules: options.modules } : {}),
      provenance: true,
      ...(model ? { model } : {}),
    });
    model = result.model;
    if (result.diagnostics.length === 0) return { ok: true };
    return { ok: false, message: result.diagnostics.map((d) => formatDiagnostic(d)).join('\n') };
  };

  const first = compile(true);
  if (!first.ok) throw new Error(`[scenoco] this project does not compile yet:\n${first.message}`);

  // The same port as last time whenever it is free: a tab the previous session left behind is
  // retrying this exact URL every second, and reclaiming the port is what lets it come back
  // instead of being stranded while a duplicate opens beside it.
  let chosen = options.port !== undefined ? { port: options.port, reused: false } : await choosePort(root);

  const serve = (port: number): Promise<ViteDevServer> =>
    createServer({
      root: appRoot,
      configFile: false,
      plugins: [react(), editorApi(root, () => model!, compile)],
      server: {
        port,
        // Listen on every interface, so the editor can be opened from a phone on the same
        // network — which is the only way to try the touch controls on real fingers. It is a
        // dev server on a local network, and `fs.allow` below still bounds what it will read.
        host: true,
        // Strict, so losing the race for the remembered port is an error we can fall back from
        // rather than a silent move to port+1 that no stranded tab is watching.
        strictPort: true,
        // The page imports the project's generated modules by absolute path, so the project has
        // to be readable. Nothing outside these two roots is.
        fs: { allow: [appRoot, root] },
      },
      // One `three` across the editor and the project, or `instanceof` quietly fails across two
      // copies and every raycast hit looks like nothing at all.
      resolve: { dedupe: ['three'] },
      optimizeDeps: { include: ['react', 'react-dom/client'] },
    });

  let vite = await serve(chosen.port);
  try {
    await vite.listen();
  } catch (error) {
    // A caller that asked for a specific port meant it; anything else falls back to a fresh one
    // (and, with it, a fresh tab — there is nothing waiting on a port we never had).
    if (options.port !== undefined) throw error;
    await vite.close().catch(() => {});
    chosen = { port: await freePort(), reused: false };
    vite = await serve(chosen.port);
    await vite.listen();
  }

  const port = (vite.httpServer!.address() as AddressInfo).port;
  rememberPort(root, port);
  const bridge = attachBridge(vite, options);

  watchProject(vite, root, compile, bridge);

  // Vite works out which interface is actually reachable; guessing from `os.networkInterfaces()`
  // picks a VPN or a container bridge as often as the Wi-Fi.
  const networkUrl = vite.resolvedUrls?.network[0]?.replace(/\/$/, '');

  return {
    url: `http://localhost:${port}`,
    ...(networkUrl ? { networkUrl } : {}),
    port,
    reusedPort: chosen.reused,
    bridge,
    model: () => model!,
    async close() {
      bridge.push({ push: 'shutdown' });
      await vite.close();
    },
  };
}

/**
 * The port to serve on: last session's if it is free, otherwise a fresh one.
 *
 * Sticky by default rather than on request, because the thing it fixes — a restart stacking up a
 * second tab while the first sits there retrying — happens on every restart.
 */
async function choosePort(root: string): Promise<{ port: number; reused: boolean }> {
  const remembered = readPort(root);
  return remembered === undefined ? { port: await freePort(), reused: false } : { port: remembered, reused: true };
}

function portFile(root: string): string {
  return join(root, '.scenoco', 'editor-port');
}

/** The port the last session bound, if one was recorded. */
function readPort(root: string): number | undefined {
  try {
    const n = Number(readFileSync(portFile(root), 'utf8').trim());
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
  } catch {
    return undefined; // no file yet, or unreadable — take a fresh port
  }
}

/** Record the port just bound. Best-effort: sticky reuse is a convenience, not a requirement. */
function rememberPort(root: string, port: number): void {
  try {
    mkdirSync(dirname(portFile(root)), { recursive: true });
    writeFileSync(portFile(root), String(port));
  } catch {
    /* couldn't write .scenoco/ — the next launch just takes a fresh port */
  }
}

/**
 * The handful of endpoints the page needs beyond its own modules.
 *
 * Everything is scoped under `/@scenoco/`, and every path that names a file is checked to be
 * inside the project — a dev server that will read any absolute path is a dev server that will
 * read your SSH key.
 */
function editorApi(
  root: string,
  model: () => ProjectModel,
  compile: (rescan: boolean) => { ok: true } | { ok: false; message: string },
) {
  const insideProject = (path: string): string | null => {
    const absolute = resolve(root, path);
    const rel = relative(root, absolute);
    return rel && !rel.startsWith('..') && !rel.startsWith(sep) ? absolute : null;
  };

  return {
    name: 'scenoco:editor-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/@scenoco/documents', (_req, res) => {
        // Every document in the project, for the file picker.
        json(res, findAssets(root).map((a) => ({ kind: a.kind, path: a.relativePath, stem: a.stem })));
      });

      server.middlewares.use('/@scenoco/model', (_req, res) => {
        // The inspector's whole schema: field names, types, defaults, doc comments, source
        // links. Read from the project's TypeScript, so it cannot drift from the code.
        const { components, systems, tags } = model();
        json(res, { components, systems, tags });
      });

      server.middlewares.use('/@scenoco/document', (req, res) => {
        const path = new URL(req.url ?? '', 'http://x').searchParams.get('path');
        const absolute = path ? insideProject(path) : null;
        if (!absolute || !existsSync(absolute)) return fail(res, 404, 'no such document');
        const text = readFileSync(absolute, 'utf8');
        json(res, {
          path,
          // The generated module the page imports to build the live scene.
          module: `/@fs${absolute.replace(/\.xml$/, '.gen.ts')}`,
          text,
          // The element index, from the **compiler's own parser** — the one whose positions the
          // provenance stamps were written with. The page reimplementing this was the one thing
          // guaranteed to drift, and it did: a long or multi-line open tag came out at a
          // different column, so every node but the short ones failed to match its element.
          elements: indexDocument(text).map((e) => ({
            tag: e.tag,
            line: e.line,
            column: e.column,
            // The byte range, so the page can lift an element's source text for a copy.
            start: e.start,
            end: e.end,
            attributes: e.attributes,
          })),
        });
      });

      server.middlewares.use('/@scenoco/save', (req, res) => {
        if (req.method !== 'POST') return fail(res, 405, 'POST only');
        readBody(req, (body) => {
          const { path, edits } = body as { path?: string; edits?: Edit[] };
          const absolute = path ? insideProject(path) : null;
          if (!absolute || !existsSync(absolute)) return fail(res, 404, 'no such document');

          const applied = applyEdits(readFileSync(absolute, 'utf8'), edits ?? []);
          if (applied.problems.length > 0) return fail(res, 409, applied.problems.join('\n'));
          if (applied.text !== readFileSync(absolute, 'utf8')) writeFileSync(absolute, applied.text);

          // Compiled synchronously so a save that breaks the document says so *here*, with the
          // diagnostics, rather than as a blank scene a moment later.
          const built = compile(false);
          if (!built.ok) return fail(res, 422, built.message);
          // The fresh index comes back with the text: every position after a splice has moved,
          // and the page's pending edits address positions.
          json(res, {
            text: applied.text,
            elements: indexDocument(applied.text).map((e) => ({
              tag: e.tag,
              line: e.line,
              column: e.column,
              start: e.start,
              end: e.end,
              attributes: e.attributes,
            })),
          });
        });
      });
    },
  };
}

/** One change to a document, addressed the way provenance addresses everything. */
export type Edit =
  | { op: 'setAttribute'; at: ElementAt; name: string; value: string | null }
  | { op: 'removeElement'; at: ElementAt }
  | { op: 'insertChild'; at: ElementAt; xml: string; index?: number }
  | { op: 'moveElement'; at: ElementAt; parent: ElementAt; index?: number };

/**
 * Apply a save.
 *
 * One at a time against the running text, because each edit's addresses are computed by the page
 * from the document it is looking at — so a batch has to be built as a sequence of
 * already-consistent steps, not as parallel edits into one snapshot.
 */
export function applyEdits(source: string, edits: readonly Edit[]): { text: string; problems: string[] } {
  let text = source;
  const problems: string[] = [];
  for (const edit of edits) {
    const result =
      edit.op === 'setAttribute'
        ? setAttribute(text, edit.at, edit.name, edit.value)
        : edit.op === 'removeElement'
          ? removeElement(text, edit.at)
          : edit.op === 'insertChild'
            ? insertChild(text, edit.at, edit.xml, edit.index)
            : moveElement(text, edit.at, edit.parent, edit.index);
    if (result.problem) problems.push(result.problem);
    text = result.text;
  }
  return { text, problems };
}

/** Rebuild when the project changes, and tell the page what happened. */
function watchProject(
  vite: ViteDevServer,
  root: string,
  compile: (rescan: boolean) => { ok: true } | { ok: false; message: string },
  bridge: EditorBridge,
): void {
  // The directory, not a glob. chokidar dropped glob support in v4 — which Vite 8 ships — so
  // `add('<root>/**/*.xml')` registered a literal path with asterisks in it, matched nothing,
  // and silently watched nothing at all: editing a document in your own editor changed the file
  // and the running editor never heard about it. What to care about is decided below anyway.
  vite.watcher.add(root);
  let queued: NodeJS.Timeout | undefined;
  let rescan = false;

  const changed = (path: string): void => {
    const isDocument = path.endsWith('.xml');
    const isSource = path.endsWith('.ts') && !path.endsWith('.gen.ts');
    if (!isDocument && !isSource) return;
    if (!path.startsWith(root)) return;
    // Watching the root means seeing installed packages and build output too; neither is
    // something a person edits, and a rescan of either costs a full recompile.
    if (path.includes(`${sep}node_modules${sep}`) || path.includes(`${sep}dist${sep}`)) return;
    rescan ||= isSource;

    clearTimeout(queued);
    queued = setTimeout(() => {
      const built = compile(rescan);
      rescan = false;
      bridge.push(
        built.ok
          ? { push: 'documentChanged', file: relative(root, path) }
          : { push: 'buildFailed', message: built.message },
      );
    }, 40);
  };

  vite.watcher.on('change', changed);
  vite.watcher.on('add', changed);
  vite.watcher.on('unlink', changed);
}

/** The WebSocket relay, plus the idle self-halt that keeps a closed tab from leaking a process. */
function attachBridge(vite: ViteDevServer, options: ServerOptions): EditorBridge {
  const { bridge, register } = createBridgeCore(options);
  const wss = new WebSocketServer({ noServer: true });
  vite.httpServer!.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith(WS_PATH)) return;
    // Vite's own HMR upgrades use a different path and fall through to its handler.
    wss.handleUpgrade(request, socket, head, (ws) => register(ws as unknown as BridgeSocket));
  });
  return bridge;
}

/**
 * The half of an editor socket this file uses — `ws`'s `WebSocket`, and anything a test can fake.
 */
export interface BridgeSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
}

/** How the bridge decides the process has nothing left to serve. */
export interface BridgeOptions {
  onIdle?: () => void;
  idleMs?: number;
  initialGraceMs?: number;
}

/**
 * Command routing, failover and the idle self-halt, with no server attached.
 *
 * Separate from `attachBridge` because these are the rules worth pinning down — which tab a
 * command goes to, what happens to a command when that tab closes, when the process gives up —
 * and none of them need a port, a browser, or a compiled project to be true.
 */
export function createBridgeCore(options: BridgeOptions = {}): {
  bridge: EditorBridge;
  register: (ws: BridgeSocket) => void;
} {
  /** Every live page, in connect order — the last one is the tab in front of the user. */
  const sockets = new Set<BridgeSocket>();
  const pending = new Map<string, Pending>();
  const waiters = new Set<() => void>();

  let idle: NodeJS.Timeout | undefined;
  const armIdle = (after: number): void => {
    if (!options.onIdle) return;
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (sockets.size === 0) options.onIdle?.();
    }, after);
  };
  armIdle(options.initialGraceMs ?? 30_000);

  /**
   * The page a command goes to: the most recently connected one still open.
   *
   * Newest rather than oldest because that is the tab the person just opened. Opening a second
   * editor tab and watching the first one answer every tool call is the whole bug.
   */
  const active = (): BridgeSocket | undefined => {
    let latest: BridgeSocket | undefined;
    for (const ws of sockets) if (ws.readyState === ws.OPEN) latest = ws;
    return latest;
  };

  const register = (ws: BridgeSocket): void => {
    sockets.add(ws);
    clearTimeout(idle);
    for (const wake of [...waiters]) wake(); // a tab attached — release anyone waiting for one
    ws.on('message', (data) => {
      const response = JSON.parse(String(data)) as EditorResponse;
      const waiting = pending.get(response.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(response.id);
      waiting.resolve(response);
    });
    ws.on('close', () => {
      sockets.delete(ws);
      // Hand anything this tab still owed to another open one, so closing the tab a tool call
      // happened to be routed to doesn't strand the call for its full timeout.
      for (const [id, waiting] of pending) {
        if (waiting.socket !== ws) continue;
        const next = active();
        if (next) {
          waiting.socket = next;
          next.send(JSON.stringify(waiting.command));
        } else {
          clearTimeout(waiting.timer);
          pending.delete(id);
          waiting.reject(new Error('the editor tab closed before answering'));
        }
      }
      if (sockets.size === 0) armIdle(options.idleMs ?? 5_000);
    });
  };

  const bridge: EditorBridge = {
    connected: () => active() !== undefined,
    push(message) {
      const text = JSON.stringify(message);
      for (const ws of sockets) ws.send(text);
    },
    waitForConnection: (ms) =>
      new Promise<boolean>((done) => {
        if (active()) return done(true);
        const wake = (): void => {
          waiters.delete(wake);
          clearTimeout(timer);
          done(true);
        };
        waiters.add(wake);
        const timer = setTimeout(() => {
          waiters.delete(wake);
          done(false);
        }, ms);
        timer.unref(); // never hold the process open just to time this out
      }),
    send(command) {
      const socket = active();
      if (!socket) return Promise.reject(new Error('no editor page is open'));
      return new Promise<EditorResponse>((resolve, reject) => {
        // A page that never answers must not hang the caller for ever — an agent waiting on a
        // screenshot has no way to tell "slow" from "gone".
        const timer = setTimeout(() => {
          pending.delete(command.id);
          reject(new Error(`the editor did not answer "${command.type}" within 30s`));
        }, 30_000);
        pending.set(command.id, { command, socket, timer, resolve, reject });
        socket.send(JSON.stringify(command));
      });
    },
  };

  return { bridge, register };
}

/** A command sent to a page and still awaiting its reply. */
interface Pending {
  command: EditorCommand;
  /** The page it went to — reassigned if that tab closes and another is open. */
  socket: BridgeSocket;
  timer: NodeJS.Timeout;
  resolve: (response: EditorResponse) => void;
  reject: (error: Error) => void;
}

// --- plumbing --------------------------------------------------------------------------------

function json(res: { setHeader(k: string, v: string): void; end(s: string): void }, data: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function fail(
  res: { statusCode: number; setHeader(k: string, v: string): void; end(s: string): void },
  code: number,
  message: string,
): void {
  res.statusCode = code;
  json(res, { error: message });
}

function readBody(req: NodeJS.ReadableStream, then: (body: unknown) => void): void {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    try {
      then(JSON.parse(raw || '{}'));
    } catch {
      then({});
    }
  });
}

function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createNetServer();
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}
