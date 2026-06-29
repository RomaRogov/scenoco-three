#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { scaffoldFiles, componentFile, sceneFile } from './templates.js';
import { deserializeBundle } from '@scenoco-three/core';
import {
  bundlePrefab,
  bundleScene,
  compilePrefabXml,
  compileSceneXml,
  formatDiagnostic,
  generateApiJson,
  generateXsd,
  loadComponents,
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
  scenoco new component <Name>              Generate src/components/<Name>.ts boilerplate
  scenoco new scene <name>                  Generate src/scenes/<name>.scene.xml skeleton
  scenoco check                             Pre-flight: @system co-location, physics
  scenoco validate <file...>                Validate scene XML; prints file:line:col diagnostics
  scenoco bundle <file> [-o out]            Build the runtime bundle (default: <file>.bundle.json)
  scenoco decompile <bundle.json> [-o out]  Inverse of bundle: a bundle back to canonical scene XML
  scenoco watch <file...> [--out dir]       Rebuild bundles on XML/resource changes
  scenoco export [--out <dir>]              Write scene.xsd + scene-api.json (default: ./schema)

Options:
  --components <dirs>   Comma-separated directories scanned for @component classes
                        (default: "src"). They are compiled and registered so scenes
                        can reference them and the exporters can document them.
  --packages <pkgs>     Comma-separated tag packages to register (e.g.
                        @scenoco-three/box2d), so their tags validate and appear
                        in the XSD/docs.

Exit code is non-zero when validation fails — wire it into your edit→check→fix loop.`;

// Commands that don't need the project's components registered first.
const SKIP_COMPONENT_LOAD = new Set(['init', 'new']);

async function main(argv: string[]): Promise<number> {
  // Strip the global --components / --packages flags; commands re-parse their own.
  const { positionals, options } = parseArgs(argv, { '--components': 'components', '--packages': 'packages' });
  const [command, ...rest] = positionals;

  if (command !== undefined && command !== '-h' && command !== '--help' && !SKIP_COMPONENT_LOAD.has(command)) {
    const roots = (options.components ?? 'src')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Tag packages (e.g. @scenoco-three/box2d) register their tags on import, so
    // validate/bundle/export/watch see them — and the XSD/docs cover them too.
    const packages = (options.packages ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await loadComponents(roots, undefined, packages.length > 0 ? { packages } : undefined);
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
  console.log('  npm run dev        # http://localhost:5173');
  console.log('  npm run validate   # check scenes');
  console.log('  npm run export     # generate schema/ (XSD + scene-api.json)');
  return 0;
}

function cmdValidate(args: string[]): number {
  if (args.length === 0) {
    console.error('validate: expected at least one file');
    return 1;
  }
  let totalErrors = 0;
  for (const file of args) {
    const path = resolve(file);
    // Compile (validate + resolve referenced files) but discard the output.
    const result = compileFile(file, readFileSync(path, 'utf8'), { path, resolve: fsResolver });
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

function cmdNew(args: string[]): number {
  const [subCommand, name] = args;
  if (!subCommand || !name) {
    console.error('new: usage: scenoco new component <Name> | scenoco new scene <name>');
    return 1;
  }

  if (subCommand === 'component') {
    const path = resolve(`src/components/${name}.ts`);
    if (existsSync(path)) {
      console.error(`new: ${path} already exists`);
      return 1;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, componentFile(name));
    console.log(`✓ created ${path}`);
    console.log(`  → add <${name} /> inside a <Components> block in your scene XML`);
    return 0;
  }

  if (subCommand === 'scene') {
    const path = resolve(`src/scenes/${name}.scene.xml`);
    if (existsSync(path)) {
      console.error(`new: ${path} already exists`);
      return 1;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, sceneFile(name));
    console.log(`✓ created ${path}`);
    console.log(`  → import scene from './${name}.scene.xml?bundle'; in main.ts`);
    return 0;
  }

  console.error(`new: unknown sub-command "${subCommand}". Use "component" or "scene".`);
  return 1;
}

async function cmdCheck(
  _args: string[],
  options: Record<string, string>,
): Promise<number> {
  const roots = (options.components ?? 'src')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const rf = readFileSync;
  const res = resolve;

  const SYSTEM_RE = /@system\s*\(/;
  const COMPONENT_RE = /@component\s*\(/;
  const NODE_TAG_RE = /@(?:node|attachment)\s*\(/;
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
      const src = rf(f, 'utf8');
      checked++;
      if (SYSTEM_RE.test(src) && !COMPONENT_RE.test(src) && !NODE_TAG_RE.test(src)) {
        const rel = f.replace(process.cwd() + '/', '');
        console.warn(`  ✗ ${rel}: @system declared but no @component/@node in same file`);
        console.warn(`      → co-locate @system(T) with @component T or this file will be skipped`);
        warnings++;
      }
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
  write(`${dir}/scene.xsd`, generateXsd());
  write(`${dir}/scene-api.json`, generateApiJson());
  console.log(`✓ wrote scene.xsd and scene-api.json to ${dir}`);
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
