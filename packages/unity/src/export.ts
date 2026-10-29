/**
 * Reads a SceNoCo project's prefabs and scenes in its own page, and writes them into a Unity project.
 *
 * The project's own Vite dev server serves one extra page that imports every module of the game but
 * its entry — so nothing starts — and hands them to core's `snapshot`, in a headless Chrome: the
 * declarations run where they were written to run, with the browser they may expect.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Response } from 'playwright-core';
import { createServer, loadConfigFromFile, type Plugin } from 'vite';
import type { Snapshot } from '@scenoco-three/core/snapshot';
import { convert, type Converted } from './convert.js';

const PAGE = '/__scenoco_unity.html';
const ENTRY = 'virtual:scenoco-unity';

/** Every module under `src/` the page may import: TypeScript and TSX, the game's entries left out. */
export function gameModules(root: string): string[] {
  const html = existsSync(join(root, 'index.html')) ? readFileSync(join(root, 'index.html'), 'utf8') : '';
  const entries = new Set([...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]!.replace(/^\//, '')));
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !/\.(test|spec)\.tsx?$/.test(name)) {
        const rel = relative(root, path).split(sep).join('/');
        if (!entries.has(rel)) out.push(`/${rel}`);
      }
    }
  };
  if (existsSync(join(root, 'src'))) walk(join(root, 'src'));
  return out.sort();
}

/** The game's own page with its entries taken out: a behaviour that reads its HUD from the DOM finds it, and nothing starts. */
function html(root: string): string {
  const file = join(root, 'index.html');
  const own = existsSync(file) ? readFileSync(file, 'utf8').replace(/<script[^>]*type="module"[^>]*src="[^"]*"[^>]*>\s*<\/script>/g, '') : '<!doctype html><meta charset="utf-8">';
  const script = `<script type="module" src="/@id/${ENTRY}"></script>`;
  return own.includes('</body>') ? own.replace('</body>', `${script}</body>`) : own + script;
}

function page(root: string, modules: string[]): Plugin {
  // Each import spelled out: Vite gives `import(variable)` a `?import` query, and with it a second
  // copy of the module — whose prefabs would not be the ones the scenes hold.
  const code = [
    `import { snapshot } from '@scenoco-three/core/snapshot';`,
    'window.__scenocoSnapshot = async () => {',
    '  const modules = {}, failed = [];',
    ...modules.map((file) => `  try { modules[${JSON.stringify(file)}] = await import(${JSON.stringify(file)}); } catch (e) { failed.push(${JSON.stringify(file)} + ': ' + e.message); }`),
    '  const out = snapshot(modules);',
    "  out.warnings.unshift(...failed.map((f) => f + ' — its prefabs are not exported.'));",
    '  return out;',
    '};',
  ].join('\n');
  return {
    name: 'scenoco-unity-export',
    resolveId: (id) => (id === ENTRY ? `\0${ENTRY}` : undefined),
    load: (id) => (id === `\0${ENTRY}` ? code : undefined),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== PAGE) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(html(root));
      });
    },
  };
}

/** Build the project's prefabs and scenes in its own page, and describe them. */
export async function snapshotProject(root: string, options: { headed?: boolean } = {}): Promise<Snapshot> {
  root = resolve(root);
  const configFile = existsSync(join(root, 'vite.config.ts')) ? join(root, 'vite.config.ts') : false;
  const loaded = configFile ? await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile, root, 'silent') : null;
  const server = await createServer({
    configFile,
    root: resolve(root, loaded?.config.root ?? '.'),
    logLevel: 'silent',
    clearScreen: false,
    plugins: [page(root, gameModules(root))],
    // Not pre-bundled: the snapshot and the scenes must share one copy of core's JSX runtime.
    optimizeDeps: { exclude: ['@scenoco-three/core'] },
    // Its own optimizer cache: a dev server or a test on the same project re-bundling the
    // shared one mid-load answers this page's imports with 504 "Outdated Optimize Dep".
    cacheDir: join(root, 'node_modules', '.vite-scenoco-unity'),
    server: { port: 0, hmr: false },
  });
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: !options.headed });
  try {
    const tab = await browser.newPage();
    const errors: string[] = [];
    tab.on('pageerror', (e) => errors.push(e.message));
    tab.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    // A cold cache can still be re-bundled while the page loads, when Vite finds a dependency its scan
    // missed. Vite's HMR client reloads the page then; with HMR off, this does.
    const url = new URL(PAGE, server.resolvedUrls!.local[0]).href;
    for (let attempt = 1; ; attempt++) {
      errors.length = 0;
      await tab.goto(url);
      if ((await pageLoaded(tab)) === 'settled' || attempt === 3) break;
    }
    await tab.waitForFunction(() => '__scenocoSnapshot' in window, null, { timeout: 1_000 }).catch(async () => {
      // The server's own reason, which the browser reports only as a status code.
      const reason = await tab.evaluate((url) => fetch(url).then((r) => (r.ok ? '' : r.text())), `/@id/${ENTRY}`).catch(() => '');
      const missing = /snapshot/.test(reason) ? ' — the project\'s @scenoco-three/core is older than this exporter: update it.' : '';
      throw new Error(`the export page did not load: ${reason.split('\n')[0] || errors.join(' — ') || 'no error was reported'}${missing}`);
    });
    try {
      return await tab.evaluate(() => (window as unknown as { __scenocoSnapshot: () => Promise<Snapshot> }).__scenocoSnapshot());
    } catch (error) {
      throw new Error(`importing the game's modules failed: ${error instanceof Error ? error.message : String(error)}${errors.length ? ` — ${errors.join(' — ')}` : ''}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * Wait for the export page: 'outdated' as soon as Vite answers one of its imports 504 — its optimizer
 * re-bundled underneath, and only a reload picks that up — and 'settled' once it loaded or gave up.
 */
function pageLoaded(tab: Page): Promise<'settled' | 'outdated'> {
  return new Promise((done) => {
    const onResponse = (response: Response) => response.status() === 504 && finish('outdated');
    const finish = (result: 'settled' | 'outdated') => {
      tab.off('response', onResponse);
      done(result);
    };
    tab.on('response', onResponse);
    // A page that never loads is reported by the caller, with the server's reason.
    tab.waitForFunction(() => '__scenocoSnapshot' in window, null, { timeout: 30_000 }).then(
      () => finish('settled'),
      () => finish('settled'),
    );
  });
}

export interface Written {
  converted: Converted;
  /** Stubs written; the rest already had a class of that name in the project. */
  scripts: string[];
}

/** Convert a snapshot and write it into the Unity project: data for the importer, the importer, C# stubs, textures. */
export function writeUnity(snap: Snapshot, project: string, root: string): Written {
  project = resolve(project);
  if (!existsSync(join(project, 'Assets')) || !existsSync(join(project, 'ProjectSettings'))) {
    throw new Error(`${project} is not a Unity project: it has no Assets/ and ProjectSettings/.`);
  }
  const relativeSource = (s: string) => {
    const at = s.lastIndexOf(':', s.lastIndexOf(':') - 1);
    const file = s.slice(0, at);
    return `${relative(root, file.startsWith('/') && existsSync(file) ? file : join(root, file)).split(sep).join('/')}${s.slice(at)}`;
  };
  // Sources are absolute in the page; a person reads them from the project.
  const tidy = (snapshot: Snapshot): Snapshot => JSON.parse(JSON.stringify(snapshot), (key, value) => (key === 'source' && typeof value === 'string' ? relativeSource(value) : value));
  const converted = convert(tidy(snap), {
    firstScene: firstScene(root),
    textures: (url) => {
      const path = decodeURIComponent(new URL(url, 'http://x').pathname);
      for (const file of [join(root, 'public', path), join(root, path)]) if (existsSync(file) && statSync(file).isFile()) return { file, name: basename(file) };
      return null;
    },
  });

  const out = (path: string) => {
    const full = join(project, path);
    mkdirSync(dirname(full), { recursive: true });
    return full;
  };
  writeFileSync(out('Assets/SceNoCo/export.json'), JSON.stringify(converted.data));
  // A dot file: Unity does not import it, the importer reads it as "a fresh export is waiting".
  writeFileSync(out('Assets/SceNoCo/.pending'), new Date().toISOString());
  copyFileSync(fileURLToPath(new URL('../unity/SceNoCoImporter.cs', import.meta.url)), out('Assets/Editor/SceNoCoImporter.cs'));
  for (const [from, to] of converted.copies) copyFileSync(from, out(to));

  const declared = classesIn(join(project, 'Assets'));
  const scripts: string[] = [];
  for (const [type, code] of converted.scripts) {
    if (declared.has(type)) continue;
    writeFileSync(out(`Assets/Scripts/${type}.cs`), code);
    scripts.push(type);
  }
  return { converted, scripts };
}

/** The scene `main.ts` plays: `play(Main)` names it. */
function firstScene(root: string): string | undefined {
  const main = join(root, 'src', 'main.ts');
  return existsSync(main) ? /\bplay\(\s*(\w+)/.exec(readFileSync(main, 'utf8'))?.[1] : undefined;
}

function classesIn(dir: string): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.cs')) for (const m of readFileSync(path, 'utf8').matchAll(/\bclass\s+(\w+)/g)) out.add(m[1]!);
    }
  };
  walk(dir);
  return out;
}
