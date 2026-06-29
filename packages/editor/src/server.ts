import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  bundlePrefab,
  bundleScene,
  compilePrefabXml,
  compileSceneXml,
  loadComponents,
  patchSceneXml,
  scanComponents,
  type PatchEdit,
  type ResourceResolver,
} from '@scenoco-three/compiler';
import { WS_PATH, type EditorCommand, type EditorPush, type EditorResponse } from './protocol.js';

export interface ServerOptions {
  /** Directories scanned for `@component`/`@node` tags (default `['src']`). */
  componentRoots?: string[];
  /** Tag packages to register (e.g. `['@scenoco-three/box2d']`). */
  packages?: string[];
  /** Fixed port (default: a free OS port). */
  port?: number;
  /** Base directory `componentRoots` are resolved against (default: `process.cwd()`). */
  cwd?: string;
}

/** Relays MCP tool commands to the connected editor page and awaits its reply. */
export interface EditorBridge {
  connected(): boolean;
  send(cmd: EditorCommand): Promise<EditorResponse>;
  /** Send an unsolicited notification to the editor page (e.g. a file change). */
  push(msg: EditorPush): void;
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
 * Start the editor's Vite dev server: serves the app, registers all project
 * components/packages, compiles any scene/prefab on demand, and bridges the page
 * to the MCP server over a WebSocket.
 */
export async function startEditorServer(opts: ServerOptions = {}): Promise<EditorServer> {
  const componentRoots = opts.componentRoots ?? ['src'];
  const packages = opts.packages ?? [];
  const port = opts.port ?? (await freePort());
  const cwd = opts.cwd ?? process.cwd();

  const watcher = createFileWatcher();
  const server = await createServer({
    configFile: false,
    root: appDir,
    logLevel: 'warn',
    server: { host: true, port, strictPort: true, fs: { strict: false } },
    plugins: [allComponentsPlugin(componentRoots, packages, cwd), bundleEndpointPlugin(componentRoots, packages, cwd, watcher)],
  });
  await server.listen();

  const bridge = attachBridge(server);
  watcher.setPush((msg) => bridge.push(msg));
  const url = server.resolvedUrls?.local[0] ?? `http://localhost:${port}/`;
  const networkUrl = server.resolvedUrls?.network[0];
  return {
    url,
    ...(networkUrl ? { networkUrl } : {}),
    bridge,
    close: async () => {
      await watcher.close();
      await server.close();
    },
  };
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

/** `virtual:scenoco-components` → import every project component + package + built-in nodes. */
function allComponentsPlugin(roots: string[], packages: string[], cwd: string): Plugin {
  const id = 'virtual:scenoco-components';
  const resolved = '\0' + id;
  return {
    name: 'scenoco:all-components',
    resolveId: (source) => (source === id ? resolved : null),
    load(source) {
      if (source !== resolved) return null;
      const files = [...scanComponents(roots, cwd).files.keys()].map((f) => `import ${JSON.stringify(`/@fs${f}`)};`);
      const pkgs = packages.map((p) => `import ${JSON.stringify(p)};`);
      return ['import "@scenoco-three/core/nodes";', ...pkgs, ...files].join('\n');
    },
  };
}

/** `GET /@scenoco/bundle?file=<abs>` → the compiled runtime bundle (JSON). */
function bundleEndpointPlugin(roots: string[], packages: string[], cwd: string, watcher: FileWatcher): Plugin {
  return {
    name: 'scenoco:bundle-endpoint',
    async configureServer(server) {
      // Register components in this Node process so compilation/validation works.
      await loadComponents(roots, cwd, { packages }).catch(() => {});
      // POST /@scenoco/save — surgical, attribute-level write-back to the source.
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || !req.url || !req.url.startsWith('/@scenoco/save')) return next();
        void readJsonBody(req)
          .then((body) => {
            const { file, edits } = (body ?? {}) as { file?: string; edits?: PatchEdit[] };
            if (!file || !Array.isArray(edits)) throw new Error('expected { file, edits }');
            const abs = resolve(cwd, file);
            const { text, changed, unresolved } = patchSceneXml(readFileSync(abs, 'utf8'), edits);
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

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/@scenoco/bundle')) return next();
        try {
          const file = new URL(req.url, 'http://x').searchParams.get('file');
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
            res.end(JSON.stringify({ error: 'compile failed', diagnostics: result.diagnostics }));
            return;
          }
          watcher.arm(abs, xml, deps); // watch this file + its src deps for changes
          const bundle = isPrefab ? bundlePrefab(result.scene) : bundleScene(result.scene);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ bundle, provenance: result.provenance }));
        } catch (e: unknown) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

/** WebSocket bridge: one editor page ↔ the MCP server, with id-correlated replies. */
function attachBridge(server: ViteDevServer): EditorBridge {
  const wss = new WebSocketServer({ noServer: true });
  let editor: WebSocket | undefined;
  const pending = new Map<string, (r: EditorResponse) => void>();

  server.httpServer?.on('upgrade', (req, socket, head) => {
    // Only our path; Vite's HMR upgrades (vite-hmr subprotocol) fall through to it.
    if (!req.url || !req.url.startsWith(WS_PATH)) return;
    wss.handleUpgrade(req, socket as never, head, (ws) => {
      editor = ws;
      ws.on('message', (data) => {
        try {
          const r = JSON.parse(String(data)) as EditorResponse;
          pending.get(r.id)?.(r);
          pending.delete(r.id);
        } catch {
          /* ignore malformed */
        }
      });
      ws.on('close', () => {
        if (editor === ws) editor = undefined;
      });
    });
  });

  return {
    connected: () => !!editor && editor.readyState === editor.OPEN,
    send: (cmd) =>
      new Promise<EditorResponse>((res, rej) => {
        if (!editor || editor.readyState !== editor.OPEN) {
          rej(new Error('no editor connected — open the editor page in a browser first'));
          return;
        }
        pending.set(cmd.id, res);
        editor.send(JSON.stringify(cmd));
        setTimeout(() => {
          if (pending.delete(cmd.id)) rej(new Error('editor did not respond in time'));
        }, 15000);
      }),
    push: (msg) => {
      if (editor && editor.readyState === editor.OPEN) editor.send(JSON.stringify(msg));
    },
  };
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
