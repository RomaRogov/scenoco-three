import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { WebSocketServer } from 'ws';
import {
  bundlePrefab,
  bundleScene,
  collectedPackageSchemas,
  compilePrefabXml,
  compileSceneXml,
  componentLoadError,
  detectTagPackages,
  generateMaterialXsd,
  generatePrefabXsd,
  generateXsd,
  loadComponents,
  patchSceneXml,
  scanComponents,
  type ComponentLoadError,
  type PatchEdit,
  type ResourceResolver,
} from '@scenoco-three/compiler';
import { WS_PATH, type EditorCommand, type EditorPush, type EditorResponse } from './protocol.js';

export interface ServerOptions {
  /** Directories scanned for `@component`/`@node` tags (default `['assets']`). */
  componentRoots?: string[];
  /** Tag packages to register (default: the `@scenoco-three/*` deps in package.json). */
  packages?: string[];
  /** Fixed port (default: a free OS port). */
  port?: number;
  /** Base directory `componentRoots` are resolved against (default: `process.cwd()`). */
  cwd?: string;
  /**
   * Called when no editor page has been connected for a while — either none ever
   * connected within `initialGraceMs` (a browser that never opened), or the last
   * open editor disconnected and none reconnected within `idleMs`. Opt-in: when
   * omitted, the server never self-halts (embedders/tests stay long-lived). The
   * CLI wires this to a graceful shutdown so no stale editor process is left
   * running once every tab is closed.
   */
  onIdle?: () => void;
  /** Idle window after the last editor disconnects before `onIdle` fires (default 5000ms). */
  idleMs?: number;
  /** Grace for the *first* editor to connect before `onIdle` fires (default 30000ms). */
  initialGraceMs?: number;
}

/** Relays MCP tool commands to the connected editor page(s) and awaits a reply. */
export interface EditorBridge {
  connected(): boolean;
  send(cmd: EditorCommand): Promise<EditorResponse>;
  /** Send an unsolicited notification to every connected editor page (e.g. a file change). */
  push(msg: EditorPush): void;
  /** Cancel the idle-shutdown timer (called on an intentional server close). */
  dispose(): void;
}

/** Watches the open file + its `src=` deps and pushes change notifications. */
export interface FileWatcher {
  /** (Re)arm the watch set after a successful compile of `openFile` with `deps`. */
  arm(openFile: string, openContents: string, deps: { path: string; contents: string }[]): void;
  /** Record content the editor itself just wrote, so its own save isn't seen as external. */
  note(file: string, contents: string): void;
  setPush(push: (msg: EditorPush) => void): void;
  close(): Promise<void>;
}

export interface EditorServer {
  /** Local URL the editor app is served at. */
  url: string;
  /** LAN URL (open on another device on the same network). */
  networkUrl?: string;
  bridge: EditorBridge;
  close(): Promise<void>;
}

const appDir = fileURLToPath(new URL('../app', import.meta.url));

/** Loads `src=` resources from disk, relative to the referencing file. */
const fsResolver: ResourceResolver = (request, referrer) => {
  const path = resolve(referrer ? dirname(referrer) : '.', request);
  return existsSync(path) ? { path, contents: readFileSync(path, 'utf8') } : null;
};

/**
 * (Re)register the project's components (change-aware — a no-op when nothing
 * changed) and, while the registry is healthy, keep the project's `schema/` XSDs
 * in sync. A corrupted component file no longer wipes the registry: the last-good
 * set stays live and the failure is returned for the editor/MCP to surface.
 */
async function refreshComponents(roots: string[], cwd: string, packages: string[]): Promise<ComponentLoadError | undefined> {
  await loadComponents(roots, cwd, { packages }).catch(() => {});
  const error = componentLoadError();
  if (!error) regenerateSchemas(cwd);
  return error;
}

/**
 * Rewrite `schema/{scene,prefab,material}.xsd` plus each tag package's XSD from the
 * live registry, so an IDE linked to them tracks component edits without a manual
 * `scenoco export`. Opt-in: only maintains an *existing* `schema/` dir; writes only
 * files whose content changed (no git churn, no watcher feedback loop).
 */
function regenerateSchemas(cwd: string): void {
  const dir = resolve(cwd, 'schema');
  if (!existsSync(dir)) return;
  writeIfChanged(resolve(dir, 'scene.xsd'), generateXsd());
  writeIfChanged(resolve(dir, 'prefab.xsd'), generatePrefabXsd());
  writeIfChanged(resolve(dir, 'material.xsd'), generateMaterialXsd());
  for (const schema of collectedPackageSchemas()) {
    try {
      writeIfChanged(resolve(dir, schema.filename), readFileSync(schema.path, 'utf8'));
    } catch {
      /* a package XSD went missing — skip it */
    }
  }
}

function writeIfChanged(path: string, content: string): void {
  try {
    if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  } catch {
    /* unreadable — fall through and overwrite */
  }
  writeFileSync(path, content);
}

/**
 * Start the editor's Vite dev server: serves the app, registers all project
 * components/packages, compiles any scene/prefab on demand, and bridges the page
 * to the MCP server over a WebSocket.
 */
export async function startEditorServer(opts: ServerOptions = {}): Promise<EditorServer> {
  const cwd = opts.cwd ?? process.cwd();
  // Convention over configuration: scan `assets/` for components and register the
  // `@scenoco-three/*` tag packages listed in the project's package.json, so the
  // editor needs no `--components`/`--packages`.
  const componentRoots = opts.componentRoots ?? ['assets'];
  const packages = opts.packages ?? detectTagPackages(cwd);
  const port = opts.port ?? (await freePort());

  const watcher = createFileWatcher();
  // Filled in after `listen()` (URLs aren't resolved until then) and served to the
  // editor page over `/@scenoco/info`, so the app can show its own LAN URL for
  // opening on another device on the network.
  const netInfo: EditorNetInfo = {};
  const server = await createServer({
    configFile: false,
    root: appDir,
    logLevel: 'warn',
    server: { host: true, port, strictPort: true, fs: { strict: false } },
    plugins: [
      allComponentsPlugin(componentRoots, packages, cwd),
      bundleEndpointPlugin(componentRoots, packages, cwd, watcher),
      infoEndpointPlugin(netInfo),
    ],
  });
  await server.listen();

  const bridge = attachBridge(server, {
    ...(opts.onIdle ? { onIdle: opts.onIdle } : {}),
    ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
    ...(opts.initialGraceMs !== undefined ? { initialGraceMs: opts.initialGraceMs } : {}),
  });
  watcher.setPush((msg) => bridge.push(msg));
  const url = server.resolvedUrls?.local[0] ?? `http://localhost:${port}/`;
  const networkUrl = server.resolvedUrls?.network[0];
  netInfo.local = url;
  netInfo.network = networkUrl;
  return {
    url,
    ...(networkUrl ? { networkUrl } : {}),
    bridge,
    close: async () => {
      bridge.dispose();
      await watcher.close();
      await server.close();
    },
  };
}

/** Resolved editor URLs, published to the page over `/@scenoco/info`. */
interface EditorNetInfo {
  local?: string;
  network?: string;
}

/**
 * A push-based file watcher: tracks the open file plus its `src=` dependencies,
 * and notifies the editor when one changes on disk. Changes whose content matches
 * what we last compiled/wrote are ignored — so the editor's own save (and no-op
 * touches) don't masquerade as external edits.
 */
function createFileWatcher(): FileWatcher {
  const w = chokidar.watch([], { ignoreInitial: true, awaitWriteFinish: true });
  const content = new Map<string, string>(); // abs path → last-known content
  let openFile = '';
  let push: (msg: EditorPush) => void = () => {};

  const onChange = (changed: string): void => {
    const abs = resolve(changed);
    if (!content.has(abs)) return; // not in our set
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      return; // deleted mid-event; ignore
    }
    if (text === content.get(abs)) return; // our own write or a no-op touch
    content.set(abs, text);
    push({ push: 'fileChanged', file: abs, role: abs === openFile ? 'open' : 'dep' });
  };
  w.on('change', onChange);
  w.on('add', onChange);

  return {
    arm(file, openContents, deps) {
      const abs = resolve(file);
      const next = new Map<string, string>([[abs, openContents]]);
      for (const d of deps) next.set(resolve(d.path), d.contents);
      for (const old of content.keys()) if (!next.has(old)) w.unwatch(old);
      for (const p of next.keys()) if (!content.has(p)) w.add(p);
      content.clear();
      for (const [k, v] of next) content.set(k, v);
      openFile = abs;
    },
    note(file, contents) {
      content.set(resolve(file), contents);
    },
    setPush(fn) {
      push = fn;
    },
    close: () => w.close(),
  };
}

/**
 * Two virtual modules, split so a broken project component can't wipe the core
 * tag registry (the P1 "Background not registered" cascade):
 *  - `virtual:scenoco-runtime`    → `@scenoco-three/core/nodes` + tag packages
 *    (the infrastructure every core scene decodes against; imported first).
 *  - `virtual:scenoco-components` → only the project's component files (fragile —
 *    a broken one throws here, isolated from core/package registration).
 * The components module is invalidated when a component file is added/removed, so
 * a deleted file never lingers as a stale import (the client-cache half of P1).
 */
function allComponentsPlugin(roots: string[], packages: string[], cwd: string): Plugin {
  const runtimeId = 'virtual:scenoco-runtime';
  const componentsId = 'virtual:scenoco-components';
  const resolvedRuntime = '\0' + runtimeId;
  const resolvedComponents = '\0' + componentsId;
  const absRoots = roots.map((r) => resolve(cwd, r));
  const isComponentFile = (file: string): boolean => SOURCE_EXT_RE.test(file) && absRoots.some((r) => resolve(file).startsWith(r));

  return {
    name: 'scenoco:all-components',
    resolveId: (source) =>
      source === runtimeId ? resolvedRuntime : source === componentsId ? resolvedComponents : null,
    load(source) {
      if (source === resolvedRuntime) {
        // Core nodes first (so core tags register even if a package throws next), then packages.
        return ['import "@scenoco-three/core/nodes";', ...packages.map((p) => `import ${JSON.stringify(p)};`)].join('\n');
      }
      if (source === resolvedComponents) {
        return [...scanComponents(roots, cwd).files.keys()].map((f) => `import ${JSON.stringify(`/@fs${f}`)};`).join('\n') || 'export {};';
      }
      return null;
    },
    configureServer(server) {
      // Vite's watcher is rooted at the editor app dir, so it only sees component
      // files once they're in the module graph (already imported). Watch the project
      // component roots explicitly, so a brand-NEW file's `add` fires too — not just
      // edits/deletes of already-imported ones.
      server.watcher.add(absRoots);
      // Adding/removing a component file changes the import list — rebuild the
      // components module (not the runtime one) and reload, so a new file gets
      // imported and a just-deleted one isn't imported from a stale graph.
      const invalidate = (file: string): void => {
        if (!isComponentFile(file)) return;
        const mod = server.moduleGraph.getModuleById(resolvedComponents);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}

/** Component source extensions the editor imports (mirrors the compiler's scan). */
const SOURCE_EXT_RE = /\.[cm]?[jt]sx?$/;

/** `GET /@scenoco/bundle?file=<abs>` → the compiled runtime bundle (JSON). */
function bundleEndpointPlugin(roots: string[], packages: string[], cwd: string, watcher: FileWatcher): Plugin {
  return {
    name: 'scenoco:bundle-endpoint',
    async configureServer(server) {
      // Register components in this Node process so compilation/validation works,
      // and publish the project's XSDs (if it has a schema/ dir).
      await refreshComponents(roots, cwd, packages);
      // POST /@scenoco/save — surgical, attribute-level write-back to the source.
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || !req.url || !req.url.startsWith('/@scenoco/save')) return next();
        void readJsonBody(req)
          .then((body) => {
            const { file, edits } = (body ?? {}) as { file?: string; edits?: PatchEdit[] };
            if (!file || !Array.isArray(edits)) throw new Error('expected { file, edits }');
            const abs = resolve(cwd, file);
            const { text, changed, unresolved } = patchSceneXml(readFileSync(abs, 'utf8'), edits);
            if (unresolved.length > 0)
              console.warn(`[scenoco] save: ${unresolved.length} edit(s) could not be located in ${file}:`, unresolved.map((u) => u.target));
            if (changed > 0) writeFileSync(abs, text);
            watcher.note(abs, text); // our own write — don't report it back as an external change
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, changed, unresolved: unresolved.length }));
          })
          .catch((e: unknown) => {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          });
      });

      // GET /@scenoco/files — the scenes/prefabs under the project's asset roots,
      // for the start-up file picker (used when the editor is opened with no ?file=).
      // Isolated to `roots` (default assets/): nothing outside them is listed.
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/@scenoco/files')) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ files: listSceneFiles(roots, cwd) }));
      });

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/@scenoco/bundle')) return next();
        void (async () => {
          // Pick up any component edits (and re-sync schema/) before compiling, with
          // last-good fallback — a broken component is reported, not fatal.
          const compError = await refreshComponents(roots, cwd, packages);
          try {
            const file = new URL(req.url!, 'http://x').searchParams.get('file');
            if (!file) throw new Error('missing ?file=');
            const abs = resolve(cwd, file);
            const xml = readFileSync(abs, 'utf8');
            const isPrefab = abs.endsWith('.prefab.xml');
            // Track which src= files the compile touches, so we can watch them too.
            const deps: { path: string; contents: string }[] = [];
            const trackingResolver: ResourceResolver = (request, referrer) => {
              const r = fsResolver(request, referrer);
              if (r) deps.push({ path: r.path, contents: r.contents });
              return r;
            };
            const result = isPrefab
              ? compilePrefabXml(xml, { path: abs, resolve: trackingResolver })
              : compileSceneXml(xml, { path: abs, resolve: trackingResolver });
            if (!result.ok) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              // A component load failure is the likely root cause of an "unknown tag"
              // compile error — pass it along so the editor can explain it.
              res.end(JSON.stringify({ error: 'compile failed', diagnostics: result.diagnostics, componentError: compError?.message }));
              return;
            }
            // A scene's sibling `*.ui.html` (its DOM UI overlay) is embedded in the
            // bundle and watched as a dep, so editing it live-refreshes the overlay
            // — visible statically even in edit mode (engine.overlay).
            if (!isPrefab) {
              const uiFile = abs.replace(/\.(scene\.)?xml$/, '.ui.html');
              if (existsSync(uiFile)) {
                const uiHtml = readFileSync(uiFile, 'utf8');
                result.scene.ui = uiHtml;
                deps.push({ path: uiFile, contents: uiHtml });
              }
            }
            watcher.arm(abs, xml, deps); // watch this file + its src/ui deps for changes
            const bundle = isPrefab ? bundlePrefab(result.scene) : bundleScene(result.scene);
            res.setHeader('Content-Type', 'application/json');
            // `componentError` is present when the scene still compiled (stale last-good
            // registry) but a component file is currently broken — a warning, not fatal.
            res.end(JSON.stringify({ bundle, provenance: result.provenance, componentError: compError?.message }));
          } catch (e: unknown) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e), componentError: compError?.message }));
          }
        })();
      });
    },
  };
}

/**
 * `GET /@scenoco/info` → the resolved editor URLs (`{ localUrl, networkUrl }`),
 * so the running page can show its own LAN address for opening the same editor on
 * another device on the network. `networkUrl` is `null` until the server has
 * finished listening (and stays `null` if the host has no LAN interface).
 */
function infoEndpointPlugin(info: EditorNetInfo): Plugin {
  return {
    name: 'scenoco:info-endpoint',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/@scenoco/info')) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ localUrl: info.local ?? null, networkUrl: info.network ?? null }));
      });
    },
  };
}

/** Options controlling the bridge's idle-shutdown behaviour (see ServerOptions). */
interface BridgeOptions {
  onIdle?: () => void;
  idleMs?: number;
  initialGraceMs?: number;
}

/**
 * The subset of a `ws` WebSocket the bridge core needs. Kept minimal so the core
 * is testable with a plain fake socket (no real server/network).
 */
export interface BridgeSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  on(event: 'message' | 'close', cb: (data: unknown) => void): void;
}

/** One in-flight command: how to settle it, and which socket it was routed to. */
interface Pending {
  cmd: EditorCommand;
  resolve: (r: EditorResponse) => void;
  reject: (e: Error) => void;
  /** The editor socket this command is currently awaiting a reply from. */
  socket: BridgeSocket;
  timer: ReturnType<typeof setTimeout>;
}

/** How long a relayed command waits for the editor's reply before giving up. */
const COMMAND_TIMEOUT_MS = 15000;

/**
 * The transport-agnostic bridge core: id-correlated command relay over one or
 * more connected editors, with failover and idle-shutdown. Split from the
 * WebSocket wiring so it can be unit-tested with fake sockets.
 *
 * Multiple editors can be connected at once (e.g. the same scene open on a laptop
 * and a phone):
 *  - commands route to the most-recently-connected still-open editor, so opening
 *    a new instance takes over control and closing it hands control back to an
 *    older one that's still open;
 *  - an in-flight command whose editor disconnects fails over to another open
 *    editor instead of erroring, so closing a tab mid-call doesn't drop it;
 *  - pushes broadcast to every open editor.
 *
 * It also self-halts an orphaned process: if no editor is connected for `idleMs`
 * (or none ever connects within `initialGraceMs`), `onIdle` fires — the CLI wires
 * this to a graceful shutdown so no stale editor process lingers after every tab
 * is closed. `onIdle` is opt-in; without it the core never schedules a halt.
 */
export function createBridgeCore(opts: BridgeOptions = {}): { bridge: EditorBridge; register: (ws: BridgeSocket) => void } {
  const editors = new Set<BridgeSocket>(); // every live editor, in connect order
  const pending = new Map<string, Pending>();

  const idleMs = opts.idleMs ?? 5000;
  const initialGraceMs = opts.initialGraceMs ?? 30000; // generous: a cold-starting browser must connect in time
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false; // an intentional close — never (re-)arm a halt after this

  const cancelIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const armIdle = (ms: number): void => {
    if (!opts.onIdle || disposed) return; // opt-in: only a process that wants to self-halt arms this
    cancelIdle();
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      opts.onIdle!();
    }, ms);
    idleTimer.unref?.(); // never keep the loop alive solely to halt it
  };
  // Wait for the first editor; reap a truly orphaned process (browser never opened).
  armIdle(initialGraceMs);

  // The control target is the most-recently-connected socket that's still open.
  const active = (): BridgeSocket | undefined => {
    let latest: BridgeSocket | undefined;
    for (const ws of editors) if (ws.readyState === ws.OPEN) latest = ws;
    return latest;
  };

  /** Remove a pending entry (clearing its timeout) and return it, if present. */
  const take = (id: string): Pending | undefined => {
    const p = pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(id);
    }
    return p;
  };

  const register = (ws: BridgeSocket): void => {
    editors.add(ws);
    cancelIdle();
    ws.on('message', (data) => {
      try {
        const r = JSON.parse(String(data)) as EditorResponse;
        take(r.id)?.resolve(r);
      } catch {
        /* ignore malformed */
      }
    });
    ws.on('close', () => {
      editors.delete(ws);
      // Fail any command awaiting this socket over to another open editor, so an
      // in-flight tool call survives closing the tab it was routed to; if none
      // is left, reject it promptly rather than waiting for the timeout.
      for (const [id, p] of pending) {
        if (p.socket !== ws) continue;
        const next = active();
        if (next) {
          p.socket = next;
          next.send(JSON.stringify(p.cmd));
        } else {
          take(id)?.reject(new Error('editor disconnected before responding'));
        }
      }
      if (editors.size === 0) armIdle(idleMs);
    });
  };

  const bridge: EditorBridge = {
    connected: () => !!active(),
    send: (cmd) =>
      new Promise<EditorResponse>((resolve, reject) => {
        const ws = active();
        if (!ws) {
          reject(new Error('no editor connected — open the editor page in a browser first'));
          return;
        }
        const timer = setTimeout(() => {
          take(cmd.id)?.reject(new Error('editor did not respond in time'));
        }, COMMAND_TIMEOUT_MS);
        pending.set(cmd.id, { cmd, resolve, reject, socket: ws, timer });
        ws.send(JSON.stringify(cmd));
      }),
    push: (msg) => {
      const data = JSON.stringify(msg);
      for (const ws of editors) if (ws.readyState === ws.OPEN) ws.send(data);
    },
    dispose: () => {
      disposed = true;
      cancelIdle();
    },
  };

  return { bridge, register };
}

/** Wire the bridge core to the dev server's WebSocket upgrades (our path only). */
function attachBridge(server: ViteDevServer, opts: BridgeOptions = {}): EditorBridge {
  const wss = new WebSocketServer({ noServer: true });
  const { bridge, register } = createBridgeCore(opts);
  server.httpServer?.on('upgrade', (req, socket, head) => {
    // Only our path; Vite's HMR upgrades (vite-hmr subprotocol) fall through to it.
    if (!req.url || !req.url.startsWith(WS_PATH)) return;
    wss.handleUpgrade(req, socket as never, head, (ws) => register(ws as unknown as BridgeSocket));
  });
  return bridge;
}

/** Read a request's JSON body (for the save endpoint). */
function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on('error', reject);
  });
}

/** A scene/prefab source the picker can open, addressed relative to `cwd`. */
export interface SceneFile {
  /** Path relative to `cwd` — what the editor passes to `?file=` / `open()`. */
  file: string;
  /** Whether it's a scene or a prefab, for the picker's label. */
  kind: 'scene' | 'prefab';
}

/**
 * Every `*.scene.xml` / `*.prefab.xml` under the asset `roots` (default assets/),
 * relative to `cwd`. Isolated to the roots — the walk never escapes them, and
 * build/cache dirs are skipped. Sorted for a stable picker order.
 */
export function listSceneFiles(roots: string[], cwd: string): SceneFile[] {
  const found = new Map<string, SceneFile>(); // keyed by file, dedupes overlapping roots
  const skip = new Set(['node_modules', 'dist', '.scenoco', '.git']);
  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing/unreadable root — nothing to list
    }
    for (const e of entries) {
      const abs = resolve(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !skip.has(e.name)) walk(abs);
      } else if (e.name.endsWith('.scene.xml') || e.name.endsWith('.prefab.xml')) {
        const file = relative(cwd, abs).split(sep).join('/');
        found.set(file, { file, kind: e.name.endsWith('.prefab.xml') ? 'prefab' : 'scene' });
      }
    }
  };
  for (const root of roots) walk(resolve(cwd, root));
  return [...found.values()].sort((a, b) => a.file.localeCompare(b.file));
}

/** Ask the OS for a free TCP port (avoids Vite's 5173-default collisions). */
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
