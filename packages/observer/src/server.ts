import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, parseSync, type ViteDevServer } from 'vite';
import { build, formatDiagnostic, indexDocument, withoutMarkers, type ProjectModel } from '@scenoco-three/compiler';

export interface ServerOptions {
  /** Project root — the directory holding `tsconfig.json` and `assets/`. Defaults to cwd. */
  root?: string;
  /** Packages whose tags the documents may use, beyond `three`. */
  modules?: readonly string[];
  /**
   * Log nothing to stdout. Required when the MCP speaks stdio: stdout *is* the protocol channel,
   * and one Vite banner in it kills the session.
   */
  quiet?: boolean;
}

export interface ProjectServer {
  url: string;
  port: number;
  /** What the project's TypeScript declares. */
  model(): ProjectModel;
  /**
   * True once the project changed and was rebuilt since the last `settle()`. The observer reads
   * this before a tool runs and reopens the document, so what an agent sees is what it last wrote.
   */
  readonly changed: boolean;
  settle(): void;
  /** Why the last rebuild failed, or null. */
  readonly failure: string | null;
  close(): Promise<void>;
}

const appRoot = fileURLToPath(new URL('../app', import.meta.url));

/**
 * The dev server behind the observer's page.
 *
 * It serves the page from this package and lets it import the **project's** generated modules
 * over `/@fs`, compiled with provenance. That is the one reason a server exists at all: a scene
 * is TypeScript that has to be transformed and resolved against the project, and Vite is what
 * does that. Nothing here talks to the page; the observer holds the browser and asks it directly.
 */
export async function startProjectServer(options: ServerOptions = {}): Promise<ProjectServer> {
  const root = resolve(options.root ?? process.cwd());
  let model: ProjectModel | undefined;

  /** Compile the project. Provenance is always on here: it is what maps a node back to its element. */
  const compile = (rescan: boolean): { ok: true } | { ok: false; message: string } => {
    if (rescan) model = undefined;
    const result = build({
      root,
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

  const port = await freePort();
  const vite = await createServer({
    root: appRoot,
    configFile: false,
    plugins: [
      documentApi(root),
      // The project's components run here too, and the build's markers must not reach the page:
      // no browser parses a decorator. `scenoco()` does the same in a project's own Vite.
      {
        name: 'scenoco:markers',
        enforce: 'pre',
        transform: (code, id) => withoutMarkers(code, id, (file, source) => parseSync(file, source).program),
      },
    ],
    ...(options.quiet ? { logLevel: 'silent' as const } : {}),
    clearScreen: false,
    server: {
      port,
      strictPort: true,
      // The page imports the project's generated modules by absolute path, so the project has
      // to be readable. Nothing outside these two roots is.
      fs: { allow: [appRoot, root] },
    },
    // One `three` across the page and the project, or `instanceof` quietly fails.
    resolve: { dedupe: ['three'] },
    optimizeDeps: {
      // Crawl the project's generated modules too, so every tag package a document imports is
      // optimized before the page loads. Discovered late, Vite re-optimizes and reloads, and the
      // module already served keeps the previous copy of `three`.
      entries: [join(appRoot, 'index.html'), join(root, 'assets/**/*.gen.ts')],
    },
  });
  await vite.listen();

  let changed = false;
  let failure: string | null = null;
  watchProject(vite, root, compile, (result) => {
    changed = true;
    failure = result.ok ? null : result.message;
  });

  return {
    url: `http://localhost:${port}`,
    port,
    model: () => model!,
    get changed() {
      return changed;
    },
    settle: () => {
      changed = false;
    },
    get failure() {
      return failure;
    },
    close: () => vite.close(),
  };
}

/**
 * The one endpoint the page needs beyond its own modules: a document, with the URL of its
 * generated module. Every path is checked to be inside the project — a dev server that will
 * read any absolute path is a dev server that will read your SSH key.
 */
function documentApi(root: string) {
  const insideProject = (path: string): string | null => {
    const absolute = resolve(root, path);
    const rel = relative(root, absolute);
    return rel && !rel.startsWith('..') && !rel.startsWith(sep) ? absolute : null;
  };
  return {
    name: 'scenoco:document-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/@scenoco/document', (req, res) => {
        const path = new URL(req.url ?? '', 'http://x').searchParams.get('path');
        const absolute = path ? insideProject(path) : null;
        if (!absolute || !existsSync(absolute)) return fail(res, 404, 'no such document');
        json(res, {
          path,
          module: `/@fs${absolute.replace(/\.xml$/, '.gen.ts')}`,
          elements: indexDocument(readFileSync(absolute, 'utf8')).map((e) => ({ tag: e.tag, line: e.line, column: e.column })),
        });
      });
    },
  };
}

/** Rebuild when the project changes, and say what happened. */
function watchProject(
  vite: ViteDevServer,
  root: string,
  compile: (rescan: boolean) => { ok: true } | { ok: false; message: string },
  onChange: (result: { ok: true; file: string } | { ok: false; message: string }) => void,
): void {
  // The directory, not a glob. chokidar dropped glob support in v4 — which Vite 8 ships — so
  // `add('<root>/**/*.xml')` registered a literal path with asterisks in it, matched nothing,
  // and silently watched nothing at all: changing a document in whatever you write XML with
  // updated the file and the running observer never heard about it. What to care about is decided below anyway.
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
      onChange(built.ok ? { ok: true, file: relative(root, path) } : { ok: false, message: built.message });
    }, 40);
  };

  vite.watcher.on('change', changed);
  vite.watcher.on('add', changed);
  vite.watcher.on('unlink', changed);
}

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

function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createNetServer();
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}
