import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { ASSET_KINDS, findAssets, type AssetKind } from './assets.js';
import { build } from './build.js';
import { describe } from './describe.js';
import { describeApi } from './scan/api.js';
import { Workspace } from './scan/workspace.js';
import { scaffold } from './scaffold.js';
import { formatDiagnostic, whatToLookUp } from './dsl/diagnostics.js';
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
    case 'describe':
      return explain(rest);
    case 'init':
      return init(rest);
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

/**
 * Answer what a name means in this project — a component, a tag, a document, or the whole list.
 *
 * A view over `build()` like every other command: the model it prints is the one the emitters
 * compile against, so the answer is what the compiler would actually accept. Runs `dryRun` so
 * asking a question never writes a file.
 */
function explain(args: readonly string[]): number {
  // A flag is never a name, and `parseFlags` reads a bare positional as the root — so the names
  // come off the front first, exactly as `new` does it.
  //
  // Several at once, because the questions come in sets: a build that has just started wants
  // `Component System Input Time` and nothing is learned by asking for them one at a time. Every
  // measured build spent eight separate turns on that fixed list, and a turn is the expensive
  // unit here — the tools themselves are 7% of a run's wall clock.
  const names: string[] = [];
  while (args[names.length] !== undefined && !args[names.length]!.startsWith('-')) {
    names.push(args[names.length]!);
  }
  const wanted = names[0];
  const flags = parseFlags(args.slice(names.length));

  const tsconfig = flags.tsconfig ?? resolve(flags.root, 'tsconfig.json');
  if (!existsSync(tsconfig)) {
    console.error(`scenoco: no tsconfig.json at ${tsconfig}. Pass --root <dir> if it lives elsewhere.`);
    return 1;
  }

  const options = {
    root: flags.root,
    ...(flags.tsconfig ? { tsconfig: flags.tsconfig } : {}),
    ...(flags.modules ? { modules: flags.modules } : {}),
    dryRun: true,
  };
  let model;
  try {
    ({ model } = build(options));
  } catch (error) {
    // A tag package installed but not yet imported stops `build` and `check`, rightly — a
    // document could name a tag nothing ships. It must not stop a *question*: the answer to
    // "what is a Component" does not depend on it, and an agent that asked exactly that got
    // "no file imports @scenoco-three/ui" and nothing else. Say it, then answer from what is
    // wired: three and the project's own components.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('no file in this project imports')) throw error;
    console.error(`${message}\nAnswering from what is imported so far.\n`);
    ({ model } = build({ ...options, modules: ['three'] }));
  }

  // A second, short-lived workspace for the declarations. `build` closes its own, and opening
  // one costs about what a question is worth; it is paid only when a name reaches the API.
  const modules = [...new Set(model.tags.map((tag) => tag.module))];
  const answer = Workspace.with(tsconfig, (workspace) => {
    const context = {
      model,
      assets: findAssets(flags.root),
      read: (path: string) => readFileSync(path, 'utf8'),
      api: (name: string) => describeApi(workspace, name, modules),
    };
    if (names.length <= 1) return describe(context, wanted);
    // A rule between answers, so a reader can see where one ends — the same job a heading does.
    return names.map((name) => describe(context, name)).join(`\n\n${'─'.repeat(78)}\n\n`);
  });
  console.log(answer);
  return 0;
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
      // One pointer for the whole run, not one per problem. A reader who has just been told a tag
      // is wrong four times needs to look that tag up once, and a diagnostic block that repeats
      // its own advice on every line is one nobody reads to the end of.
      const lookUp = whatToLookUp(result.diagnostics);
      if (lookUp.length > 0) {
        const shown = lookUp.slice(0, 3);
        console.error(
          `To see what ${shown.length > 1 ? 'these take' : 'it takes'}: ` +
            shown.map((name) => `scenoco describe ${name}`).join('  ·  '),
        );
      }
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

/**
 * Scaffold a whole project — the first thing anyone runs.
 *
 * The same view over the same templates that `new` is, one level up: `new` writes one document,
 * `init` writes the project that document would live in.
 */
function init(args: readonly string[]): number {
  const target = args.find((arg) => !arg.startsWith('-')) ?? '.';
  try {
    const result = scaffold(target);
    console.log(`Created ${result.written.length} files in ${result.directory}\n`);
    if (target !== '.') console.log(`  cd ${target}`);
    console.log('  npm install');
    console.log('  npm run dev\n');
    console.log('Arrow keys move the block, Space drops a crate. Then read AGENTS.md — the model in a');
    console.log('page — and assets/scenes/main.scene.xml, which ends with one thing to try that shows');
    console.log('what the compiler does when you slip.');
    return 0;
  } catch (error) {
    console.error(`scenoco init: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** Scaffold one document from its starter template. */
function create(args: readonly string[]): number {
  // A flag is never a name: `scenoco new asset --root .` asks for the primitives in that
  // directory, not for a document called "--root".
  const [kind, ...tail] = args;
  const name = tail[0]?.startsWith('-') ? undefined : tail[0];
  const afterName = name === undefined ? tail : tail.slice(1);
  // `scenoco new asset crate MeshStandardMaterial` — the root tag, which is what an asset is.
  const tag = afterName[0]?.startsWith('-') ? undefined : afterName[0];
  const rest = tag === undefined ? afterName : afterName.slice(1);
  const kinds = ASSET_KINDS.map((k) => k.kind);

  if (!kind || !kinds.includes(kind as AssetKind['kind'])) {
    console.error(
      kind
        ? `scenoco new: "${kind}" is not a kind of document. Try one of: ${kinds.join(', ')}.`
        : `scenoco new <kind> <name>\n\nKinds: ${kinds.join(', ')}`,
    );
    return 1;
  }
  // `scenoco new asset` with no name means the whole set of primitives. Unity has its built-in
  // meshes; a SceNoCo project has these documents, and needing seven commands to get a cube and a
  // cylinder is the sort of friction that ends with someone typing numbers into a mesh instead.
  if (!name && kind === 'asset') return createAll(Object.keys(PRIMITIVES), parseFlags(rest));
  if (!name) {
    console.error(`scenoco new ${kind} <name>${kind === 'asset' ? ' [Tag]' : ''}`);
    return 1;
  }

  const flags = parseFlags(rest);
  return write(kind as AssetKind['kind'], name, flags, tag) ? 0 : 1;
}

/** Every primitive geometry, skipping any the project already has. */
function createAll(names: readonly string[], flags: Flags): number {
  let written = 0;
  for (const name of names) {
    const template = templateFor('asset', name);
    if (existsSync(resolve(flags.root, template.path))) continue;
    if (write('asset', name, flags)) written += 1;
  }
  if (written === 0) console.log('scenoco: every primitive geometry is already there.');
  return 0;
}

/** Write one starter document. False when it was refused. */
function write(kind: AssetKind['kind'], name: string, flags: Flags, tag?: string): boolean {
  const template = templateFor(kind, name, tag);
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
  scenoco init <dir>      a whole project that runs: scene, component, shapes, Vite wired up
  scenoco new <kind> <name>
  scenoco new asset       the primitives: ${Object.keys(PRIMITIVES).join(', ')}
  scenoco new asset <name> <Tag>
                          one shared three.js object, rooted at <Tag>
  scenoco describe [name…]
                          what a name means here — a component, a tag, a document, or a
                          runtime API like Input or Coroutine. Several names answer in one
                          go: describe Component System Input Time.
                          With no name: the whole vocabulary, and how the pieces fit
                          together. Start there if you have not used this before.

Options
  --root <dir>            project root (default: the current directory)
  --tsconfig <file>       default: <root>/tsconfig.json
  --modules a,b           packages whose tags the documents may use, beyond three

Kinds
${ASSET_KINDS.map((k) => `  ${k.kind.padEnd(width)}  ${k.description}`).join('\n')}
`);
}
