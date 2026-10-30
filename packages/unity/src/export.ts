/**
 * Reads a SceNoCo project's prefabs and scenes in its own page, and writes them into a Unity project.
 *
 * The project's own Vite dev server serves one extra page that imports every module of the game but
 * its entry — so nothing starts — and hands them to core's `snapshot`, in a headless Chrome: the
 * declarations run where they were written to run, with the browser they may expect.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Response } from 'playwright-core';
import { createServer, loadConfigFromFile, type Plugin } from 'vite';
import type { Snapshot } from '@scenoco-three/core/snapshot';
import { convert, type Converted } from './convert.js';
import { inputActions } from './input.js';
import { convertPage } from './page.js';
import { moduleStub } from './stub.js';

const PAGE = '/__scenoco_unity.html';
const ENTRY = 'virtual:scenoco-unity';

/**
 * Every module under `src/` the page may import: TypeScript and TSX, the game's entries left out, and
 * so are `*.worker.ts` and `*.worklet.ts` — code for another thread, which no scene on the page holds.
 */
export function gameModules(root: string): string[] {
  const html = existsSync(join(root, 'index.html')) ? readFileSync(join(root, 'index.html'), 'utf8') : '';
  const entries = new Set([...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]!.replace(/^\//, '')));
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !/\.(test|spec|worker|worklet)\.tsx?$/.test(name)) {
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

/** The physics packages the game has, by the class whose layer matrix the export reads. */
const PHYSICS = [
  ['@scenoco-three/box2d', 'Physics2D', 'ignore2D'],
  ['@scenoco-three/rapier', 'Physics', 'ignore3D'],
] as const;

function page(root: string, modules: string[]): Plugin {
  // The game's own dependencies say which it has; in a workspace the package itself may be hoisted anywhere.
  const json = existsSync(join(root, 'package.json')) ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) : {};
  const deps = { ...json.dependencies, ...json.devDependencies };
  const installed = PHYSICS.filter(([pkg]) => pkg in deps);
  // Each import spelled out: Vite gives `import(variable)` a `?import` query, and with it a second
  // copy of the module — whose prefabs would not be the ones the scenes hold.
  const code = [
    `import { snapshot } from '@scenoco-three/core/snapshot';`,
    `import { AXES } from '@scenoco-three/core';`,
    ...installed.map(([pkg, name]) => `import { ${name} } from '${pkg}';`),
    'window.__scenocoSnapshot = async () => {',
    '  const modules = {}, failed = [];',
    ...modules.map((file) => `  try { modules[${JSON.stringify(file)}] = await import(${JSON.stringify(file)}); } catch (e) { failed.push(${JSON.stringify(file)} + ': ' + e.message); }`),
    '  const out = snapshot(modules);',
    "  out.warnings.unshift(...failed.map((f) => f + ' — its prefabs are not exported.'));",
    // What the modules set up as they loaded, which no element declares: the named axes, the layer matrix, the layers' names.
    '  out.axes = AXES;',
    ...installed.map(([, name, key]) => `  out.${key} = []; for (let a = 0; a < 16; a++) for (let b = a; b < 16; b++) if (${name}.getIgnoreLayerCollision(a, b)) out.${key}.push([a, b]);`),
    '  out.layerNames = {};',
    '  for (const mod of Object.values(modules)) for (const [name, value] of Object.entries(mod)) {',
    '    if (!/layer/i.test(name) || !value || typeof value !== "object") continue;',
    '    const entries = Object.entries(value);',
    '    if (entries.length && entries.every(([, n]) => Number.isInteger(n) && n > 0 && n < 16)) for (const [k, n] of entries) out.layerNames[n] = k;',
    '  }',
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
export async function snapshotProject(root: string, options: { headed?: boolean } = {}): Promise<ExportSnapshot> {
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
      return await tab.evaluate(() => (window as unknown as { __scenocoSnapshot: () => Promise<ExportSnapshot> }).__scenocoSnapshot());
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
  /** Module stubs written: the game's code outside its behaviours. */
  modules: string[];
  /** What the page, its fonts and its images could not carry across. */
  warnings: string[];
}

/** What the export page reads besides the snapshot: what the game's modules set up as they loaded. */
export interface ExportSnapshot extends Snapshot {
  /** Core's named axes and buttons, `AXES`. */
  axes?: Record<string, { negative?: string[]; positive?: string[]; mouse?: number; stick?: { axis: number; invert?: boolean } }>;
  /** Layer pairs that pass through each other, by physics package. */
  ignore2D?: [number, number][];
  ignore3D?: [number, number][];
  /** A layer's name, from an exported constant such as `Layer = { ball: 1 }`. */
  layerNames?: Record<number, string>;
}

/**
 * Convert a snapshot and write it into the Unity project: data for the importer, the importer, C# stubs,
 * textures, the page as UXML and USS with its images and fonts, the input actions — and what the agent
 * porting the game reads and drives it with: the porting rules, and the `scenoco` commands for Unity's CLI.
 */
export async function writeUnity(snap: ExportSnapshot, project: string, root: string): Promise<Written> {
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
  // A texture drawn in code arrives as its canvas' PNG: written out, named by its content.
  const drawn = mkdtempSync(join(tmpdir(), 'scenoco-unity-'));
  const converted = convert(tidy(snap), {
    firstScene: firstScene(root),
    source: (file) => {
      const path = join(root, file);
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    },
    textures: (url) => {
      if (url.startsWith('data:image/png;base64,')) {
        const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
        const name = `drawn-${createHash('sha1').update(bytes).digest('hex').slice(0, 10)}.png`;
        writeFileSync(join(drawn, name), bytes);
        return { file: join(drawn, name), name };
      }
      const path = decodeURIComponent(new URL(url, 'http://x').pathname);
      for (const file of [join(root, 'public', path), join(root, path)]) if (existsSync(file) && statSync(file).isFile()) return { file, name: basename(file) };
      return null;
    },
    layers: { names: snap.layerNames ?? {}, ignore2D: snap.ignore2D ?? [], ignore3D: snap.ignore3D ?? [] },
  });

  const out = (path: string) => {
    const full = join(project, path);
    mkdirSync(dirname(full), { recursive: true });
    return full;
  };
  const warnings: string[] = [];

  // The page: each UIDocument's element as UXML, the style as USS, with its images and web fonts.
  const elements = new Set<string>();
  const visit = (n: Snapshot['prefabs'][number]['root']) => {
    for (const c of n.components) if (c.type === 'UIDocument') elements.add(typeof c.fields.element === 'string' ? c.fields.element : 'ui');
    n.children.forEach(visit);
  };
  snap.prefabs.forEach((p) => visit(p.root));
  const page = await convertPage(root, [...elements]);
  warnings.push(...page.warnings);
  for (const [path, text] of page.files) writeFileSync(out(path), text);
  for (const [from, to] of page.copies) copyFileSync(from, out(to));
  for (const [url, to] of page.downloads) {
    if (existsSync(join(project, to))) continue;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      writeFileSync(out(to), Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      warnings.push(`${url} could not be downloaded — ${(error as Error).message}.`);
    }
  }
  converted.data.ui = { documents: Object.fromEntries(page.documents), theme: 'Assets/UI/Theme.tss' };

  // SceNoCo's named axes and buttons as the project-wide input actions.
  if (snap.axes) {
    writeFileSync(out('Assets/SceNoCo/Input/SceNoCo.inputactions'), inputActions(snap.axes));
    converted.data.input = 'Assets/SceNoCo/Input/SceNoCo.inputactions';
  }

  writeFileSync(out('Assets/SceNoCo/export.json'), JSON.stringify(converted.data));
  // A dot file: Unity does not import it, the importer reads it as "a fresh export is waiting".
  writeFileSync(out('Assets/SceNoCo/.pending'), new Date().toISOString());
  const own = (file: string) => fileURLToPath(new URL(`../unity/${file}`, import.meta.url));
  copyFileSync(own('SceNoCoImporter.cs'), out('Assets/Editor/SceNoCoImporter.cs'));
  // Rewritten by every export, as the importer is: they are the exporter's, not the port's.
  copyFileSync(own('PORTING.md'), out('Assets/SceNoCo/PORTING.md'));
  copyFileSync(own('KeepAcrossScenes.cs'), out('Assets/SceNoCo/Runtime/KeepAcrossScenes.cs'));
  for (const file of ['SceNoCoDriver.cs', 'SceNoCo.Driver.asmdef']) copyFileSync(own(`Driver/${file}`), out(`Assets/SceNoCo/Driver/${file}`));
  for (const [from, to] of converted.copies) copyFileSync(from, out(to));
  rmSync(drawn, { recursive: true, force: true });

  const declared = classesIn(join(project, 'Assets'));
  const scripts: string[] = [];
  for (const [type, code] of converted.scripts) {
    if (declared.has(type)) continue;
    writeFileSync(out(`Assets/Scripts/${type}.cs`), code);
    scripts.push(type);
  }

  // The rest of the game's code — modules with no behaviour — as TypeScript in a .cs each, written once.
  const behaviourFiles = new Set(Object.values(snap.classes).map((c) => c.file));
  const modules: string[] = [];
  for (const file of sourceFiles(root)) {
    if (behaviourFiles.has(file)) continue;
    const target = out(`Assets/Scripts/Modules/${file.replace(/^\/src\//, '').replace(/\.tsx?$/, '')}.cs`);
    if (existsSync(target)) continue;
    writeFileSync(target, moduleStub(file, readFileSync(join(root, file), 'utf8')));
    modules.push(file);
  }
  return { converted, scripts, modules, warnings };
}

/** Every TypeScript module under `src/` — the entry too — but the scenes, which the export already carries. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.(d|test|spec)\.ts$/.test(name)) out.push(`/${relative(root, path).split(sep).join('/')}`);
    }
  };
  if (existsSync(join(root, 'src'))) walk(join(root, 'src'));
  return out.sort();
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
