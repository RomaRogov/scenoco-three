#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { scaffoldFiles, componentFile, sceneFile, prefabFile, materialFile, systemFile } from './templates.js';
import { deserializeBundle } from '@scenoco-three/core';
import {
  assetKinds,
  bundlePrefab,
  bundleScene,
  collectedPackageSchemas,
  compilePrefabXml,
  compileSceneXml,
  detectTagPackages,
  srcDocumentForFile,
  validateAssetXml,
  type AssetKindDef,
  formatDiagnostic,
  generateApiJson,
  generateMaterialXsd,
  generatePrefabXsd,
  generateXsd,
  loadComponents,
  type ComponentScan,
  serializeScene,
  watchSceneFiles,
  type Bundle,
  type CompileOptions,
  type CompileResult,
  type ResourceResolver,
} from '../index.js';

/** Loads `src=` resources from disk, relative to the referencing file. */
const fsResolver: ResourceResolver = (request, referrer) => {
  const path = resolve(referrer ? dirname(referrer) : '.', request);
  return existsSync(path) ? { path, contents: readFileSync(path, 'utf8') } : null;
};

/** A `.prefab.xml` file compiles as a standalone, dynamically-instantiable prefab. */
const isPrefabFile = (file: string) => file.endsWith('.prefab.xml');

function compileFile(file: string, xml: string, options: CompileOptions): CompileResult {
  return isPrefabFile(file) ? compilePrefabXml(xml, options) : compileSceneXml(xml, options);
}

function bundleFor(file: string, scene: import('../index.js').CompiledScene): Bundle {
  return isPrefabFile(file) ? bundlePrefab(scene) : bundleScene(scene);
}

const USAGE = `scenoco — Scene · Node · Component CLI

Usage:
  scenoco init [dir]                        Scaffold a new SceNoCo project (default: current dir)
  scenoco new <kind> <name>                 Create an asset — run bare to list the kinds
  scenoco check                             Pre-flight: scans components + flags physics setup
  scenoco validate <file...>                Validate any asset document; prints file:line:col diagnostics
  scenoco bundle <file> [-o out]            Build the runtime bundle (default: <file>.bundle.json)
  scenoco decompile <bundle.json> [-o out]  Inverse of bundle: a bundle back to canonical scene XML
  scenoco watch <file...> [--out dir]       Rebuild bundles on XML/resource changes
  scenoco export [--out <dir>]              Write scene/prefab/material(+package) .xsd + scene-api.json (default: ./schema)

Options:
  --components <dirs>   Comma-separated directories scanned for @component classes
                        (default: "assets"). They are compiled and registered so scenes
                        can reference them and the exporters can document them.
  --packages <pkgs>     Comma-separated tag packages to register (e.g.
                        @scenoco-three/box2d), so their tags validate and appear
                        in the XSD/docs.

Exit code is non-zero when validation fails — wire it into your edit→check→fix loop.`;

// Commands that don't need the project's components registered first. Only
// `init`, which runs before a project exists — `new` needs the registry, because
// the kinds it offers include the document formats the project's tag packages own.
const SKIP_COMPONENT_LOAD = new Set(['init']);

// The scan from the bootstrap load, so `export` can record where each tag,
// component and system is declared (project file vs. tag package).
let loadedScan: ComponentScan | undefined;

async function main(argv: string[]): Promise<number> {
  // Strip the global --components / --packages flags; commands re-parse their own.
  const { positionals, options } = parseArgs(argv, { '--components': 'components', '--packages': 'packages' });
  const [command, ...rest] = positionals;

  if (command !== undefined && command !== '-h' && command !== '--help' && !SKIP_COMPONENT_LOAD.has(command)) {
    const roots = (options.components ?? 'assets')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Tag packages register their tags on import so validate/bundle/export/watch
    // see them (and the XSD/docs cover them). Default to the @scenoco-three/* deps
    // in package.json; --packages overrides.
    const packages =
      options.packages !== undefined
        ? options.packages.split(',').map((s) => s.trim()).filter(Boolean)
        : detectTagPackages();
    loadedScan = await loadComponents(roots, undefined, packages.length > 0 ? { packages } : undefined);
  }

  switch (command) {
    case 'init':
      return cmdInit(rest);
    case 'new':
      return cmdNew(rest);
    case 'check':
      return await cmdCheck(rest, options);
    case 'validate':
      return cmdValidate(rest);
    case 'bundle':
      return cmdBundle(rest);
    case 'decompile':
      return cmdDecompile(rest);
    case 'watch':
      return cmdWatch(rest);
    case 'export':
      return cmdExport(rest);
    case undefined:
    case '-h':
    case '--help':
      console.log(USAGE);
      return command === undefined ? 1 : 0;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      return 1;
  }
}

function cmdInit(args: string[]): number {
  const { positionals } = parseArgs(args, {});
  const dir = resolve(positionals[0] ?? '.');
  const name = basename(dir).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'scenoco-app';

  const files = scaffoldFiles(name);
  let written = 0;
  let skipped = 0;
  for (const [rel, content] of Object.entries(files)) {
    const path = resolve(dir, rel);
    if (existsSync(path)) {
      console.warn(`  skip  ${rel} (already exists)`);
      skipped++;
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`  create  ${rel}`);
    written++;
  }

  console.log(`\n✓ scaffolded "${name}" (${written} files${skipped ? `, ${skipped} skipped` : ''})`);
  console.log('\nNext:');
  console.log(`  ${dir === process.cwd() ? '' : `cd ${positionals[0] ?? '.'} && `}npm install`);
  console.log('  npm run export     # generate schema/ (XSD + scene-api.json)');
  console.log('  npm run dev        # http://localhost:5173');
  console.log('\nThe scene has a camera and a light and nothing else. Add to it with:');
  console.log('  scenoco new component <Name>   # behaviour');
  console.log('  scenoco new prefab <name>      # a reusable node subtree');
  console.log('  scenoco new                    # every kind available here');
  return 0;
}

function cmdValidate(args: string[]): number {
  if (args.length === 0) {
    console.error(`validate: expected at least one file\n\nCheckable documents: ${assetKinds().map((k) => k.extension).join(', ')}`);
    return 1;
  }
  let totalErrors = 0;
  for (const file of args) {
    const path = resolve(file);
    // Every asset kind, dispatched on the extension: scenes and prefabs compile,
    // materials check as standalone attachment documents, and a package-owned
    // `src=` document goes to the format's own compiler.
    const result = validateAssetXml(file, readFileSync(path, 'utf8'), { path, resolve: fsResolver });
    if (!result.ok) {
      for (const d of result.diagnostics) console.error(formatDiagnostic(d, file));
      totalErrors += result.diagnostics.length;
    }
  }
  if (totalErrors === 0) {
    console.log(`✓ ${args.length} file(s) valid`);
    return 0;
  }
  console.error(`\n✗ ${totalErrors} problem(s) in ${args.length} file(s)`);
  return 1;
}

/** Compile a scene/prefab XML and write its optimized runtime bundle. */
function cmdBundle(args: string[]): number {
  const { positionals, options } = parseArgs(args, { '-o': 'out', '--out': 'out' });
  const file = positionals[0];
  if (!file) {
    console.error('bundle: expected a file');
    return 1;
  }
  const path = resolve(file);
  const result = compileFile(file, readFileSync(path, 'utf8'), { path, resolve: fsResolver });
  if (!result.ok) {
    for (const d of result.diagnostics) console.error(formatDiagnostic(d, file));
    console.error(`\n✗ cannot bundle ${file}: ${result.diagnostics.length} problem(s)`);
    return 1;
  }
  const out = resolve(options.out ?? `${file}.bundle.json`);
  writeFileSync(out, JSON.stringify(bundleFor(file, result.scene)));
  console.log(`✓ bundled ${file} → ${out}`);
  return 0;
}

/** Inverse of bundle: a runtime bundle back to canonical scene XML. */
function cmdDecompile(args: string[]): number {
  const { positionals, options } = parseArgs(args, { '-o': 'out', '--out': 'out' });
  const file = positionals[0];
  if (!file) {
    console.error('decompile: expected a .bundle.json file');
    return 1;
  }
  const data: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'));
  if (!Array.isArray(data)) {
    console.error('decompile: expected a runtime bundle (a JSON array). Produce one with `scenoco bundle`.');
    return 1;
  }
  const scene = deserializeBundle(data as Bundle);
  const out = resolve(options.out ?? file.replace(/(\.bundle)?\.json$/, '') + '.scene.xml');
  writeFileSync(out, serializeScene(scene));
  console.log(`✓ decompiled ${file} → ${out}`);
  return 0;
}

/**
 * One entry per thing `scenoco new` can create: where the file goes, what goes
 * in it, and what to do with it next. Code kinds (component, system) are fixed;
 * document kinds come from `assetKinds()`, so a tag package that brings its own
 * format (particles' `.particle.xml`) shows up here without the CLI listing it.
 */
interface NewKind {
  kind: string;
  description: string;
  /** Where the file lands, relative to the project root. */
  path(name: string): string;
  render(name: string): string;
  /** The one thing to do with it next — printed after creation. */
  next(name: string): string;
}

const CODE_KINDS: NewKind[] = [
  {
    kind: 'component',
    description: 'A @component class: per-instance behaviour, authored in <Components>',
    path: (n) => `assets/components/${n}.ts`,
    render: componentFile,
    next: (n) => `add <${n} /> inside a <Components> block in a scene`,
  },
  {
    kind: 'system',
    description: 'A @system class: batch processing for every component of one type',
    path: (n) => `assets/systems/${n}.ts`,
    render: systemFile,
    // A `@system(T)` has no meaning without its component type, so the template
    // imports one derived from the name (SpawnerSystem → Spawner). Say so when
    // that component does not exist yet, rather than leaving a file whose import
    // is red for no stated reason.
    next: (n) => {
      const component = n.replace(/System$/, '') || 'Target';
      return existsSync(resolve(`assets/components/${component}.ts`))
        ? `it runs automatically wherever a <${component} /> is in the scene`
        : `it processes <${component} />, which does not exist yet — run: scenoco new component ${component}`;
    },
  },
];

/** The document template for a built-in asset kind; package formats bring their own. */
const BUILTIN_DOC_TEMPLATES: Record<string, (name: string) => string> = {
  scene: sceneFile,
  prefab: prefabFile,
  material: materialFile,
};

/** Everything `new` can make, in a stable order: documents first, then code. */
function newKinds(): NewKind[] {
  const docs = assetKinds().map((k): NewKind => {
    const render = BUILTIN_DOC_TEMPLATES[k.kind] ?? templateOf(k);
    return {
      kind: k.kind,
      description: k.description,
      path: (n) => `${k.dir}/${n}${k.extension}`,
      render,
      next: nextStepFor(k),
    };
  });
  return [...docs, ...CODE_KINDS];
}

/** A package-owned format supplies its own starter document. */
function templateOf(k: AssetKindDef): (name: string) => string {
  const def = srcDocumentForFile(`x${k.extension}`);
  return def ? def.template : () => '';
}

function nextStepFor(k: AssetKindDef): (name: string) => string {
  if (k.kind === 'scene') return (n) => `import scene from './${n}.scene.xml?bundle'; in main.ts`;
  if (k.kind === 'prefab') return (n) => `place it with <PrefabInstance src="${n}.prefab.xml" /> in a scene`;
  return (n) => `point an element at it with src="../${basename(k.dir)}/${n}${k.extension}"`;
}

function cmdNew(args: string[]): number {
  const [subCommand, name] = args;
  const kinds = newKinds();

  if (!subCommand || !name) {
    console.error(`new: usage: scenoco new <kind> <name>\n\n${kindTable(kinds)}`);
    return 1;
  }

  const kind = kinds.find((k) => k.kind === subCommand);
  if (!kind) {
    console.error(`new: unknown kind "${subCommand}".\n\n${kindTable(kinds)}`);
    return 1;
  }

  const path = resolve(kind.path(name));
  if (existsSync(path)) {
    console.error(`new: ${path} already exists`);
    return 1;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, kind.render(name));
  console.log(`✓ created ${path}`);
  console.log(`  → ${kind.next(name)}`);
  return 0;
}

/** The available kinds, aligned — the same list `new` dispatches on. */
function kindTable(kinds: NewKind[]): string {
  const width = Math.max(...kinds.map((k) => k.kind.length));
  return ['Kinds:', ...kinds.map((k) => `  ${k.kind.padEnd(width)}  ${k.description}`)].join('\n');
}

async function cmdCheck(
  _args: string[],
  options: Record<string, string>,
): Promise<number> {
  const roots = (options.components ?? 'assets')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const rf = readFileSync;
  const res = resolve;

  const PHYSICS_RE = /<Physics[\s/]/;
  const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
  const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.scenoco']);

  let warnings = 0;
  let checked = 0;

  function walkFiles(dir: string): string[] {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    const stack = [dir];
    while (stack.length > 0) {
      const d = stack.pop()!;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!SKIP.has(e.name)) stack.push(res(d, e.name));
        } else {
          out.push(res(d, e.name));
        }
      }
    }
    return out;
  }

  console.log('Checking components...');
  for (const root of roots) {
    for (const f of walkFiles(res(process.cwd(), root))) {
      if (!SOURCE_EXT.test(f) || f.endsWith('.d.ts')) continue;
      checked++;
      // (A stand-alone @system file is no longer a problem — discovery ships it
      // by the component it processes; see @scenoco-three/compiler components.ts.)
    }
  }

  console.log('\nChecking scenes...');
  let sceneCount = 0;
  const seenScenes = new Set<string>();
  for (const root of roots) {
    // Walk from the root's parent so sibling scenes/ directories are included,
    // but deduplicate across roots so no file is checked twice.
    const searchDir = res(process.cwd(), root, '..');
    for (const f of walkFiles(searchDir)) {
      if (seenScenes.has(f)) continue;
      if (!f.endsWith('.scene.xml') && !f.endsWith('.prefab.xml')) continue;
      seenScenes.add(f);
      const src = rf(f, 'utf8');
      const rel = f.replace(process.cwd() + '/', '');
      sceneCount++;
      if (PHYSICS_RE.test(src)) {
        console.log(`  ℹ  ${rel}: uses <Physics> — ensure await initRapier() is in main.ts`);
      }
    }
  }

  console.log(
    `\n${warnings === 0 ? '✓' : '✗'} checked ${checked} source file(s) + ${sceneCount} scene(s)` +
      (warnings > 0 ? `, ${warnings} warning(s)` : ' — no issues found'),
  );
  return warnings > 0 ? 1 : 0;
}

function cmdWatch(args: string[]): number {
  const { positionals, options } = parseArgs(args, { '--out': 'out', '-o': 'out' });

  if (positionals.length === 0) {
    console.error('watch: expected at least one file');
    return 1;
  }

  const entries = positionals.map((f) => resolve(f));

  void watchSceneFiles(entries, {
    outDir: options.out ? resolve(options.out) : undefined,
    resolve: fsResolver,
    onEvent(event) {
      if (event.type === 'diagnostics') {
        for (const d of event.diagnostics) console.error(formatDiagnostic(d, event.file));
        return;
      }
      if (event.type === 'success') {
        console.log(`✓ rebuilt ${event.file} → ${event.outputPath} (${event.durationMs} ms)`);
        return;
      }
      if (event.type === 'error') {
        console.error(`✗ watch error in ${event.file}: ${event.message}`);
      }
    },
  }).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });

  console.log(`watching ${entries.length} file(s)`);
  return 0;
}

function cmdExport(args: string[]): number {
  const { options } = parseArgs(args, { '--out': 'out', '-o': 'out' });
  const dir = resolve(options.out ?? 'schema');
  // Document schemas derivable from the registry: scenes, prefabs, materials.
  write(`${dir}/scene.xsd`, generateXsd());
  write(`${dir}/prefab.xsd`, generatePrefabXsd());
  write(`${dir}/material.xsd`, generateMaterialXsd());
  write(`${dir}/scene-api.json`, generateApiJson({ sources: loadedScan }));
  const written = ['scene.xsd', 'prefab.xsd', 'material.xsd'];
  // Package-owned `src=` document schemas (e.g. particles' particle.xsd) — copied
  // verbatim from each registered tag package that ships one.
  for (const schema of collectedPackageSchemas()) {
    write(`${dir}/${schema.filename}`, readFileSync(schema.path, 'utf8'));
    written.push(schema.filename);
  }
  console.log(`✓ wrote ${written.join(', ')} + scene-api.json to ${dir}`);
  return 0;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Minimal flag parser: maps known flags (with a value) to option keys. */
function parseArgs(
  args: string[],
  flags: Record<string, string>,
): { positionals: string[]; options: Record<string, string> } {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const key = flags[arg];
    if (key) {
      options[key] = args[++i] ?? '';
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, options };
}

// Set the exit code but let the event loop drain naturally — `watch` keeps the
// process alive through its file watcher; every other command just finishes.
process.exitCode = await main(process.argv.slice(2));
