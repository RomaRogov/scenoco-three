import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { ASSET_KINDS, type AssetKind } from './assets.js';
import { build } from './build.js';
import { formatDiagnostic } from './dsl/diagnostics.js';
import { PRIMITIVES, templateFor } from './templates.js';

/**
 * `scenoco` — the command line over the compiler.
 *
 * Every command here is a thin view over `build()` or over `ASSET_KINDS`; none of them knows a
 * document format. That is deliberate: the list of kinds, their extensions and their directories
 * are declared once, so a new kind appears in `new`, in `check` and in this help text without an
 * edit here.
 */
export async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case 'build':
      return compile(rest, { watch: false });
    case 'watch':
      return compile(rest, { watch: true });
    case 'check':
      return compile(rest, { watch: false, dryRun: true });
    case 'new':
      return create(rest);
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      help();
      return 0;
    default:
      console.error(`scenoco: unknown command "${command}"\n`);
      help();
      return 1;
  }
}

interface Flags {
  root: string;
  tsconfig?: string;
  modules?: string[];
}

/** Compile the project's documents. `check` does it without writing anything. */
async function compile(args: readonly string[], options: { watch: boolean; dryRun?: boolean }): Promise<number> {
  const flags = parseFlags(args);

  // The likeliest first run of all: `scenoco build` in the wrong directory. A document's whole
  // vocabulary is read from the project's TypeScript, so without a tsconfig there is nothing to
  // read — and "No TypeScript project at …" on its own does not say that.
  const tsconfig = flags.tsconfig ?? resolve(flags.root, 'tsconfig.json');
  if (!existsSync(tsconfig)) {
    console.error(
      `scenoco: no tsconfig.json at ${tsconfig}.\n` +
        'A document takes its tags from the project\'s own TypeScript, so this has to run inside ' +
        'the project. Pass --root <dir> if it lives elsewhere.',
    );
    return 1;
  }

  const once = (): boolean => {
    const started = Date.now();
    const result = build({
      root: flags.root,
      ...(flags.tsconfig ? { tsconfig: flags.tsconfig } : {}),
      ...(flags.modules ? { modules: flags.modules } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
    });
    for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
    if (result.diagnostics.length > 0) {
      console.error(`\n${result.diagnostics.length} problem(s).`);
      return false;
    }
    const verb = options.dryRun ? 'checked' : 'wrote';
    console.log(`scenoco: ${verb} ${result.files.size} file(s) in ${Date.now() - started}ms`);
    return true;
  };

  if (!options.watch) return once() ? 0 : 1;

  once();
  // Imported here rather than at the top: watching is the only thing that needs it, and `build`
  // and `check` are what run in CI.
  const { watch: watchFiles } = await import('node:fs');
  console.log(`scenoco: watching ${flags.root}`);
  let queued: NodeJS.Timeout | undefined;
  watchFiles(flags.root, { recursive: true }, (_event, file) => {
    // A generated file changing is this process's own writing coming back.
    if (!file || file.endsWith('.gen.ts') || file.includes('node_modules')) return;
    if (!file.endsWith('.xml') && !file.endsWith('.ts')) return;
    clearTimeout(queued);
    queued = setTimeout(once, 40);
  });
  return new Promise<number>(() => {}); // runs until interrupted
}

/** Scaffold one document from its starter template. */
function create(args: readonly string[]): number {
  // A flag is never a name: `scenoco new geometry --root .` asks for the primitives in that
  // directory, not for a document called "--root".
  const [kind, ...tail] = args;
  const name = tail[0]?.startsWith('-') ? undefined : tail[0];
  const rest = name === undefined ? tail : tail.slice(1);
  const kinds = ASSET_KINDS.map((k) => k.kind);

  if (!kind || !kinds.includes(kind as AssetKind['kind'])) {
    console.error(
      kind
        ? `scenoco new: "${kind}" is not a kind of document. Try one of: ${kinds.join(', ')}.`
        : `scenoco new <kind> <name>\n\nKinds: ${kinds.join(', ')}`,
    );
    return 1;
  }
  // `scenoco new geometry` with no name means the whole set of primitives. Unity has its built-in
  // meshes; a SceNoCo project has these documents, and needing seven commands to get a cube and a
  // cylinder is the sort of friction that ends with someone typing numbers into a mesh instead.
  if (!name && kind === 'geometry') return createAll(Object.keys(PRIMITIVES), parseFlags(rest));
  if (!name) {
    console.error(`scenoco new ${kind} <name>`);
    return 1;
  }

  const flags = parseFlags(rest);
  return write(kind as AssetKind['kind'], name, flags) ? 0 : 1;
}

/** Every primitive geometry, skipping any the project already has. */
function createAll(names: readonly string[], flags: Flags): number {
  let written = 0;
  for (const name of names) {
    const template = templateFor('geometry', name);
    if (existsSync(resolve(flags.root, template.path))) continue;
    if (write('geometry', name, flags)) written += 1;
  }
  if (written === 0) console.log('scenoco: every primitive geometry is already there.');
  return 0;
}

/** Write one starter document. False when it was refused. */
function write(kind: AssetKind['kind'], name: string, flags: Flags): boolean {
  const template = templateFor(kind, name);
  const path = resolve(flags.root, template.path);
  if (existsSync(path)) {
    // Never silently: a starter document overwriting real work is unrecoverable.
    console.error(`scenoco new: ${relative(flags.root, path)} already exists.`);
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, template.contents);
  console.log(`scenoco: created ${relative(flags.root, path)}`);
  return true;
}

function parseFlags(args: readonly string[]): Flags {
  const flags: Flags = { root: process.cwd() };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--root') flags.root = resolve(args[++i] ?? '.');
    else if (arg === '--tsconfig') flags.tsconfig = resolve(args[++i] ?? '');
    else if (arg === '--modules') flags.modules = (args[++i] ?? '').split(',').filter(Boolean);
    else if (!arg.startsWith('-')) flags.root = resolve(arg);
  }
  return flags;
}

function help(): void {
  const width = Math.max(...ASSET_KINDS.map((k) => k.kind.length));
  console.log(`scenoco — compile SceNoCo documents to TypeScript

  scenoco build [dir]     compile every document in the project
  scenoco watch [dir]     compile, then recompile as documents and components change
  scenoco check [dir]     compile without writing — for CI
  scenoco new <kind> <name>
  scenoco new geometry    the primitives: ${Object.keys(PRIMITIVES).join(', ')}

Options
  --root <dir>            project root (default: the current directory)
  --tsconfig <file>       default: <root>/tsconfig.json
  --modules a,b           packages whose tags the documents may use, beyond three

Kinds
${ASSET_KINDS.map((k) => `  ${k.kind.padEnd(width)}  ${k.description}`).join('\n')}
`);
}
