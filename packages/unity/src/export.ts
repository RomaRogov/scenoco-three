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
import { moduleStub, typeAliases } from './stub.js';
import { twins } from './twin.js';

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
    `import { AXES, Asset, loadAssets } from '@scenoco-three/core';`,
    ...installed.map(([pkg, name]) => `import { ${name} } from '${pkg}';`),
    'window.__scenocoSnapshot = async () => {',
    '  const modules = {}, failed = [];',
    ...modules.map((file) => `  try { modules[${JSON.stringify(file)}] = await import(${JSON.stringify(file)}); } catch (e) { failed.push(${JSON.stringify(file)} + ': ' + e.message); }`),
    // What `main.ts` awaits before it plays — models, terrains — loaded as it would be: every asset the
    // modules export, alone or in an object or a list, and every model prefab, so a scene that reads or places one finds it.
    '  const assets = new Set(), seen = new Set();',
    '  const find = (v, depth) => { if (typeof v === "function") { assets.add(v); return; } if (!v || typeof v !== "object" || seen.has(v) || depth > 3) return; seen.add(v); if (v instanceof Asset) { assets.add(v); return; } if (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) for (const x of Object.values(v)) find(x, depth + 1); };',
    '  for (const mod of Object.values(modules)) for (const v of Object.values(mod)) find(v, 0);',
    '  await Promise.all([...assets].map((a) => loadAssets(a).catch((e) => failed.push(`${a.url ?? a.constructor.name}: did not load — ${e.message}`))));',
    '  const out = snapshot(modules);',
    // Every file the modules load — a sound kept in a table, not only one a field names — for the port to have.
    '  out.files = [...assets].filter((a) => typeof a.url === "string").map((a) => ({ url: a.url, type: a.constructor.name }));',
    "  out.warnings.unshift(...failed.map((f) => (f.includes('did not load') ? f : f + ' — its prefabs are not exported.')));",
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
  /** The scenes' and prefabs' text, by the path Scenoco builds each from. */
  twins: string[];
  /** Packages added to the project's manifest: Scenoco, which builds the text, and Diceload, which checks the port. */
  packages: string[];
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
  /** Every file the game's modules load, by URL and the class that loads it: copied in whether or not a field names it. */
  files?: { url: string; type: string }[];
}

/**
 * Convert a snapshot and write it into the Unity project: the scenes and prefabs as Scenoco's text, data
 * for the importer that makes the assets they name, the importer, C# stubs, textures, the page as UXML
 * and USS with its images and fonts, the input actions — and the porting rules, with Scenoco and Diceload
 * in the project's manifest for the agent that ports and checks it.
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
  // The page: each UIDocument's element as UXML, the style as USS, with its images and web fonts.
  const elements = new Set<string>();
  const visit = (n: Snapshot['prefabs'][number]['root']) => {
    for (const c of n.components) if (c.type === 'UIDocument') elements.add(typeof c.fields.element === 'string' ? c.fields.element : 'ui');
    n.children.forEach(visit);
  };
  snap.prefabs.forEach((p) => visit(p.root));
  const page = await convertPage(root, [...elements]);
  // Each <template> as UXML, by id: a behaviour that clones one gets a field for it.
  const templates = Object.fromEntries(page.templates);
  // A texture drawn in code arrives as its canvas' PNG: written out, named by its content.
  const drawn = mkdtempSync(join(tmpdir(), 'scenoco-unity-'));
  const converted = convert(tidy(snap), {
    firstScene: firstScene(root),
    aliases: aliasesIn(root),
    templates,
    files: snap.files?.filter((f) => f.type === 'Model' || f.type === 'AudioClip'),
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
  const ui = { documents: Object.fromEntries(page.documents), theme: 'Assets/UI/Theme.tss' };
  converted.data.ui = ui;
  // Unity's own packages for what the game has: glTF models, splines.
  const has = (type: string) => [...converted.data.prefabs.map((p) => p.root), ...converted.data.scenes.flatMap((sc) => sc.roots)].some(function visit(n): boolean {
    return n.components.some((c) => c.type === type) || n.children.some(visit);
  });
  const needed: Record<string, string> = {};
  const models = [...converted.copies].filter(([, to]) => /\.(glb|gltf)$/i.test(to)).map(([from]) => from);
  if (models.length) needed['com.unity.cloud.gltfast'] = UNITY_PACKAGES['com.unity.cloud.gltfast']!;
  for (const name of gltfDecoders(models)) needed[name] = UNITY_PACKAGES[name]!;
  if (has('SplineContainer')) needed['com.unity.splines'] = UNITY_PACKAGES['com.unity.splines']!;
  const packages = addPackages(project, needed);

  // SceNoCo's named axes and buttons as the project-wide input actions.
  if (snap.axes) {
    writeFileSync(out('Assets/SceNoCo/Input/SceNoCo.inputactions'), inputActions(snap.axes));
    converted.data.input = 'Assets/SceNoCo/Input/SceNoCo.inputactions';
  }

  // C# stubs, written once: a class the project has already is the port's, and its fields are what the scenes wire.
  const declared = classesIn(join(project, 'Assets'));
  const scripts: string[] = [];
  for (const [type, code] of converted.scripts) {
    if (declared.has(type)) continue;
    writeFileSync(out(`Assets/Scripts/${type}.cs`), code);
    declared.set(type, code);
    scripts.push(type);
  }

  // The scenes and prefabs as text, left where Unity imports nothing until the importer has made what they name.
  const manifest = readManifest(project);
  const text = twins(converted.data, {
    documents: ui.documents,
    declares: (type, field) => serializedFields(declared.get(type) ?? '').has(field),
    eventSystem: 'com.unity.ugui' in manifest && 'com.unity.inputsystem' in manifest,
  });
  if (!('com.unity.ugui' in manifest)) warnings.push("the project has no com.unity.ugui: the UI's EventSystem is left out of the first scene.");
  warnings.push(...text.warnings);
  rmSync(join(project, STAGED), { recursive: true, force: true });
  for (const [path, body] of text.files) writeFileSync(out(`${STAGED}/${path.slice('Assets/'.length)}`), body);
  const t = converted.data;
  // What only a placed copy named, where the prefab's own stands in, is made nowhere.
  const named = [...text.files.values()].join('\n');
  const data = {
    meshes: t.meshes.filter((m) => named.includes(m.path)),
    terrains: t.terrains,
    materials: t.materials.filter((m) => named.includes(m.path)),
    layers: t.layers,
    modelVariants: t.modelVariants,
    dataTextures: t.dataTextures,
    input: t.input,
    theme: ui.theme,
    ...text.assets,
    twins: [...text.files.keys()],
    scenes: t.scenes.map(({ path, fog, ambient }) => ({ path, fog, ambient })),
    warnings: [...new Set(t.warnings)],
  };
  writeFileSync(out('Assets/SceNoCo/export.json'), JSON.stringify(data));
  // A dot file: Unity does not import it, the importer reads it as "a fresh export is waiting".
  writeFileSync(out('Assets/SceNoCo/.pending'), new Date().toISOString());
  const own = (file: string) => fileURLToPath(new URL(`../unity/${file}`, import.meta.url));
  copyFileSync(own('SceNoCoImporter.cs'), out('Assets/Editor/SceNoCoImporter.cs'));
  // SceNoCo's onValidate runs on a move too: in Unity, this script calls OnValidate for one.
  copyFileSync(own('SceNoCoValidate.cs'), out('Assets/Editor/SceNoCoValidate.cs'));
  // Rewritten by every export, as the importer is: they are the exporter's, not the port's.
  copyFileSync(own('PORTING.md'), out('Assets/SceNoCo/PORTING.md'));
  copyFileSync(own('KeepAcrossScenes.cs'), out('Assets/SceNoCo/Runtime/KeepAcrossScenes.cs'));
  // Only for a game that uses them: they need the Splines package, which only such a game gets.
  for (const [tag, file] of [['SplineKnotNodes', 'SplineKnotNodes.cs'], ['SplineMesh', 'SplineMesh.cs']] as const) {
    const path = `Assets/SceNoCo/Runtime/${file}`;
    if ([...text.files.values()].some((t) => t.includes(`<${tag} `) || t.includes(`<${tag}>`) || t.includes(`<${tag}/`))) copyFileSync(own(file), out(path));
    else for (const old of [path, `${path}.meta`]) rmSync(join(project, old), { force: true });
  }
  // An earlier export's Play-mode commands: Diceload's simulations check the port now.
  for (const old of ['Assets/SceNoCo/Driver', 'Assets/SceNoCo/Driver.meta']) rmSync(join(project, old), { recursive: true, force: true });
  for (const [from, to] of converted.copies) copyFileSync(from, out(to));
  rmSync(drawn, { recursive: true, force: true });

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
  // Tweens port to DOTween, which the export can't install: it needs the person (an Asset Store login, or a download).
  const tweening = sourceFiles(root).filter((file) => usesTweens(readFileSync(join(root, file), 'utf8')));
  if (tweening.length && !hasDotween(join(project, 'Assets'))) {
    warnings.push(`the game tweens (${tweening.map((f) => f.replace(/^\/src\//, '')).join(', ')}): its port needs the free DOTween — Assets/SceNoCo/PORTING.md ▸ "Tweens" says how to install it.`);
  }
  // One line per thing said: a prefab placed fifty times says what its copies share once.
  return { converted, twins: [...text.files.keys()], packages, scripts, modules, warnings: [...new Set(warnings)] };
}

/** Whether a module tweens with core's API — `Tween.sequence()`, `node.doMove(…)` — which a port writes with DOTween. */
export function usesTweens(code: string): boolean {
  return /\bTween\.(sequence|to|float|delayedCall|kill|killAll)\s*\(|\.do[A-Z]\w*\s*\(/.test(code);
}

/** Whether the Unity project has DOTween: its assembly anywhere under Assets. */
function hasDotween(dir: string): boolean {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === 'DOTween.dll') return true;
    if (statSync(path).isDirectory() && !name.endsWith('~') && hasDotween(path)) return true;
  }
  return false;
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

/** Every type alias the game's modules declare, by name; a name declared twice keeps its first. */
function aliasesIn(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
        try {
          for (const [k, v] of typeAliases(readFileSync(path, 'utf8'), path)) if (!out.has(k)) out.set(k, v);
        } catch {
          // A module that does not parse has no aliases to give; its own stub says what failed.
        }
      }
    }
  };
  if (existsSync(join(root, 'src'))) walk(join(root, 'src'));
  return out;
}

/** The scene `main.ts` plays: `play(Main)` names it. */
function firstScene(root: string): string | undefined {
  const main = join(root, 'src', 'main.ts');
  return existsSync(main) ? /\bplay\(\s*(\w+)/.exec(readFileSync(main, 'utf8'))?.[1] : undefined;
}

/** Every class the project's C# declares, with the text of its file. */
function classesIn(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.cs')) {
        const code = readFileSync(path, 'utf8');
        for (const m of code.matchAll(/\bclass\s+(\w+)/g)) out.set(m[1]!, code);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * The fields a C# file declares that Unity serializes, as a scene sets them: public ones, and
 * `[SerializeField]` ones — not static, const or readonly, not a property or a method.
 */
export function serializedFields(code: string): Set<string> {
  const out = new Set<string>();
  for (const raw of code.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '');
    if (!/\bpublic\b|\[SerializeField\]/.test(line) || /\b(static|const|readonly|class|struct|enum|interface|event)\b/.test(line)) continue;
    if (line.includes('=>')) continue;
    // Brackets' insides first — `new(30, 30)`, `Dictionary<string, int>`, `[SerializeField]` — so a comma
    // left is one between names: `public GameObject a, b = x, c;` declares three.
    let flat = line;
    for (let before = ''; before !== flat; ) {
      before = flat;
      flat = flat.replace(/\([^()]*\)|\{[^{}]*\}|<[^<>]*>|\[[^[\]]*\]/g, '');
    }
    const m = /^\s*(?:(?:public|private|protected|internal|new)\s+)*[\w.?]+\s+([^;]+);\s*$/.exec(flat);
    if (!m) continue;
    for (const part of m[1]!.split(',')) {
      const name = /^\s*(\w+)\s*(=|$)/.exec(part)?.[1];
      if (name) out.add(name);
    }
  }
  return out;
}

/** Where the export leaves the scenes' and prefabs' text for the importer: Unity imports nothing in a folder ending in ~. */
const STAGED = 'Assets/SceNoCo/Twins~';

/** The packages the export needs in the Unity project, at the versions it was written for. */
const PACKAGES: Record<string, string> = {
  'com.roro.scenoco': 'https://github.com/RomaRogov/scenoco-unity.git#v0.2.0',
  'com.roro.diceload': 'https://github.com/RomaRogov/diceload.git#v0.5.0',
};

/** Unity's packages the export adds when the game needs them, at versions Unity 6 takes. */
const UNITY_PACKAGES: Record<string, string> = {
  'com.unity.cloud.gltfast': '6.21.0',
  // glTFast decodes a compressed model only with these beside it; meshopt's are all experimental releases.
  'com.unity.meshopt.decompress': '0.3.0-exp.1',
  'com.unity.cloud.draco': '5.6.0',
  'com.unity.cloud.ktx': '3.8.0',
  'com.unity.splines': '2.9.2',
};

/** The glTF extensions a model may need a decoder package for, by the package glTFast reads it with. */
const GLTF_DECODERS: Record<string, string> = {
  EXT_meshopt_compression: 'com.unity.meshopt.decompress',
  KHR_draco_mesh_compression: 'com.unity.cloud.draco',
  KHR_texture_basisu: 'com.unity.cloud.ktx',
};

/** The decoder packages `files` (.glb or .gltf) need: read from each file's JSON, its `extensionsUsed`. */
export function gltfDecoders(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    try {
      const bytes = readFileSync(file);
      // A .glb is a 12-byte header, then its JSON chunk: length, type, text.
      const json = bytes.readUInt32LE(0) === 0x46546c67 ? bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8') : bytes.toString('utf8');
      for (const ext of (JSON.parse(json).extensionsUsed ?? []) as string[]) if (GLTF_DECODERS[ext]) out.add(GLTF_DECODERS[ext]!);
    } catch {
      // A model that can't be read is glTFast's to report, at its import.
    }
  }
  return out;
}

function readManifest(project: string): Record<string, string> {
  const file = join(project, 'Packages', 'manifest.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).dependencies ?? {}) : {};
}

/** Scenoco and Diceload in the project's manifest, where it names neither: what was added. A version or path it gives is kept. */
function addPackages(project: string, extra: Record<string, string> = {}): string[] {
  const file = join(project, 'Packages', 'manifest.json');
  if (!existsSync(file)) throw new Error(`${project} has no Packages/manifest.json.`);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.dependencies ??= {};
  const wanted = { ...PACKAGES, ...extra };
  const added = Object.keys(wanted).filter((name) => !(name in manifest.dependencies));
  for (const name of added) manifest.dependencies[name] = wanted[name];
  if (added.length) writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return added;
}
