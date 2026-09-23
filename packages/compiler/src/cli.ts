import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_KINDS, findAssets, type AssetKind } from './assets.js';
import { documentKinds, notesOf, readModuleManifests } from './manifest.js';
import { build } from './build.js';
import { configIndex, describe } from './describe.js';
import { describeApi } from './scan/api.js';
import type { ConfigShape } from './scan/interfaces.js';
import type { ProjectModel } from './model.js';
import { Workspace } from './scan/workspace.js';
import { scaffold } from './scaffold.js';
import { formatDiagnostic, whatToLookUp } from './dsl/diagnostics.js';
import { PRIMITIVES, templateFor } from './templates.js';

/**
 * `scenoco` — the command line over the compiler.
 *
 * Every command here is a thin view over `build()` or over the project's document kinds; none of
 * them knows a document format. That is deliberate: a kind, its extension and its directory are
 * declared once — by the compiler or by a package — so a new one appears in `new`, in `check` and
 * in this help text without an edit here.
 */
export async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case 'build':
      return compile(rest, { watch: false });
    case 'watch': {
      // `scenoco watch -- vite`: everything after the separator is a command to run beside the
      // watcher, so the dev loop is one process to start and one to stop.
      const separator = rest.indexOf('--');
      return separator === -1
        ? compile(rest, { watch: true })
        : compile(rest.slice(0, separator), { watch: true, child: rest.slice(separator + 1) });
    }
    case 'check':
      return compile(rest, { watch: false, dryRun: true });
    case 'new':
      return create(rest);
    case 'describe':
      return explain(rest);
    case 'init':
      return init(rest);
    case '-v':
    case '--version':
      console.log(identity());
      return 0;
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
  const modules_ = readModuleManifests(flags.root).modules;
  let model;
  let shapes: ReadonlyMap<string, ConfigShape | undefined>;
  try {
    ({ model, shapes } = build(options));
  } catch (error) {
    // A tag package installed but not yet imported stops `build` and `check`, rightly — a
    // document could name a tag nothing ships. It must not stop a *question*: the answer to
    // "what is a Component" does not depend on it, and an agent that asked exactly that got
    // "no file imports @scenoco-three/ui" and nothing else. Say it, then answer from what is
    // wired: three and the project's own components.
    const message = error instanceof Error ? error.message : String(error);
    // Anything the toolchain refuses outright — an unimported package, two packages claiming one
    // document kind — is a reason not to *build*. It is never a reason not to answer a question.
    if (!message.startsWith('[scenoco] ')) throw error;
    console.error(`${message}\nAnswering from what is wired up so far.\n`);
    ({ model, shapes } = build({ ...options, modules: ['three'], kinds: BUILTIN_KINDS }));
  }

  // A second, short-lived workspace for the declarations. `build` closes its own, and opening
  // one costs about what a question is worth; it is paid only when a name reaches the API.
  const modules = [...new Set(model.tags.map((tag) => tag.module))];
  const kinds = documentKinds(flags.root);
  const answer = Workspace.with(tsconfig, (workspace) => {
    const context = {
      model,
      kinds,
      assets: findAssets(flags.root, kinds).documents,
      read: (path: string) => readFileSync(path, 'utf8'),
      api: (name: string) => describeApi(workspace, name, modules),
      notes: notesOf(modules_),
      // The elements of every config document this project has, each askable by its own name.
      configs: configIndex(shapes.values()),
    };
    if (names.length <= 1) return describe(context, wanted);
    // A rule between answers, so a reader can see where one ends — the same job a heading does.
    return names.map((name) => describe(context, name)).join(`\n\n${'─'.repeat(78)}\n\n`);
  });
  console.log(answer);
  return 0;
}

/** Compile the project's documents. `check` does it without writing anything. */
async function compile(
  args: readonly string[],
  options: { watch: boolean; dryRun?: boolean; child?: readonly string[] },
): Promise<number> {
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

  /**
   * The last scan, reused while only documents change.
   *
   * The two halves are one cache: both are read from the same declarations in the same pass, so
   * a rescan drops them together. Keeping the shapes while dropping the model would leave a
   * package's edited config type reported as it was, which reads as the compiler refusing an
   * attribute that is plainly declared.
   *
   * Only `watch` fills them — a one-shot build scans once anyway.
   */
  let model: ProjectModel | undefined;
  let shapes: ReadonlyMap<string, ConfigShape | undefined> | undefined;

  const once = (rescan = true): boolean => {
    const started = Date.now();
    // Scanning the project's TypeScript is the expensive half, and a document cannot change what
    // its own vocabulary is — so an edit to a `.xml` reuses the scan and only an edit to a `.ts`
    // pays for a new one.
    if (rescan) {
      model = undefined;
      shapes = undefined;
    }
    const result = build({
      root: flags.root,
      ...(flags.tsconfig ? { tsconfig: flags.tsconfig } : {}),
      ...(flags.modules ? { modules: flags.modules } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
      // `build` and `check` exist to find problems, so both typecheck what they compiled. A
      // question — `describe` — does not, and does not pay for it.
      typecheck: true,
      ...(model ? { model } : {}),
      ...(shapes ? { shapes } : {}),
    });
    if (options.watch) {
      model = result.model;
      shapes = result.shapes;
    }
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
      // Who said all this. A project can resolve a different compiler than the one you think it
      // does — an older one installed beside it answers with an older vocabulary, and every message
      // above then reads as the toolchain contradicting itself. Printed only on the way out.
      console.error(identity());
      return false;
    }
    const verb = options.dryRun ? 'checked' : 'wrote';
    console.log(`scenoco: ${verb} ${result.files.size} file(s) in ${Date.now() - started}ms`);
    for (const note of unloadedScenes(flags.root, result.files)) console.log(note);
    return true;
  };

  if (!options.watch) return once() ? 0 : 1;

  once();
  // Imported here rather than at the top: watching is the only thing that needs them, and `build`
  // and `check` are what run in CI.
  const { watch: watchFiles } = await import('node:fs');

  // Started even when the build above failed. Whoever ran `npm run dev` in the background must
  // not be handed a dead process for a typo: the diagnostics are above, the server is up, and the
  // next save fixes it in place.
  //
  // Not awaited: the promise settles when the child *exits*, which is the exit code this command
  // returns at the bottom. Awaiting it here left the watcher unbuilt and every later save silent.
  const child = options.child?.length ? spawnChild(options.child) : undefined;

  console.log(`scenoco: watching ${flags.root}`);
  let queued: NodeJS.Timeout | undefined;
  let rescan = false;
  watchFiles(flags.root, { recursive: true }, (_event, file) => {
    // A generated file changing is this process's own writing coming back.
    if (!file || file.endsWith('.gen.ts') || file.includes('node_modules')) return;
    if (!file.endsWith('.xml') && !file.endsWith('.ts')) return;
    rescan ||= file.endsWith('.ts');
    clearTimeout(queued);
    queued = setTimeout(() => {
      once(rescan);
      rescan = false;
    }, 40);
  });
  // Runs until interrupted — or, with a child, until the child is done and its code is ours.
  return child ?? new Promise<number>(() => {});
}

/**
 * Run a command beside the watcher — `scenoco watch -- vite`.
 *
 * One process to start and one to stop, which is the only reason this exists: two terminals for
 * one dev loop is a step nobody remembers, and a bundler started separately outlives the watcher
 * that feeds it. Its output is this process's own, so the bundler's URL is where it has always
 * been, and the answer to "why did it stop" is whatever the child printed.
 */
async function spawnChild(command: readonly string[]): Promise<number> {
  const { spawn } = await import('node:child_process');
  const [program, ...args] = command as [string, ...string[]];
  const child = spawn(program, args, { stdio: 'inherit', shell: process.platform === 'win32' });

  // Forwarded rather than relied upon: Ctrl+C in a terminal reaches the whole group already, but
  // a parent killed by a supervisor is the case where the bundler would otherwise be orphaned.
  const relay = (signal: NodeJS.Signals) => (): void => {
    child.kill(signal);
  };
  process.on('SIGINT', relay('SIGINT'));
  process.on('SIGTERM', relay('SIGTERM'));

  return new Promise<number>((done) => {
    child.on('error', (error) => {
      console.error(`scenoco watch: could not run "${command.join(' ')}": ${error.message}`);
      done(1);
    });
    child.on('exit', (code, signal) => done(signal ? 0 : (code ?? 1)));
  });
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
    // Inside the workspace that *builds* these packages, `npm install` is the wrong next step:
    // the project already resolves them through the symlinks above it, and installing replaces
    // those with whatever is published. Two compilers then answer with two vocabularies, and
    // every message reads as the toolchain contradicting itself.
    if (linkedPackages(result.directory)) {
      console.log('  npm run dev\n');
      console.log('(The @scenoco-three packages already resolve to this workspace, through the');
      console.log(' node_modules above this directory. Running `npm install` here would replace');
      console.log(' them with the published copies, which is almost certainly not what you want.)\n');
    } else {
      console.log('  npm install');
      console.log('  npm run dev\n');
    }
    console.log('Arrow keys move the block, Space drops a crate. Then read AGENTS.md — the model in a');
    console.log('page — and assets/scenes/main.scene.xml, which ends with one thing to try that shows');
    console.log('what the compiler does when you slip.');
    return 0;
  } catch (error) {
    console.error(`scenoco init: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * True when a `@scenoco-three` package already resolves from above `directory` as a symlink —
 * which is to say, this is somewhere inside the workspace that builds them.
 */
function linkedPackages(directory: string): boolean {
  for (let dir = resolve(directory); ; dir = dirname(dir)) {
    const scope = join(dir, 'node_modules', '@scenoco-three');
    try {
      // Any of them: a workspace links every package it builds, and which ones a given project
      // happens to depend on is not the question being asked.
      if (readdirSync(scope).some((name) => lstatSync(join(scope, name)).isSymbolicLink())) return true;
    } catch {
      // Nothing there; keep climbing.
    }
    if (dirname(dir) === dir) return false;
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
  const flags = parseFlags(rest);
  // What *this* project can make: the builtins plus whatever its packages declare.
  const kinds = documentKinds(flags.root);
  const names = kinds.map((k) => k.kind);

  if (!kind || !names.includes(kind)) {
    console.error(
      kind
        ? `scenoco new: "${kind}" is not a kind of document. Try one of: ${names.join(', ')}.`
        : `scenoco new <kind> <name>\n\nKinds: ${names.join(', ')}`,
    );
    return 1;
  }
  // `scenoco new asset` with no name means the whole set of primitives. Unity has its built-in
  // meshes; a SceNoCo project has these documents, and needing seven commands to get a cube and a
  // cylinder is the sort of friction that ends with someone typing numbers into a mesh instead.
  if (!name && kind === 'asset') return createAll(Object.keys(PRIMITIVES), flags, kinds);
  if (!name) {
    console.error(`scenoco new ${kind} <name>${kind === 'asset' ? ' [Tag]' : ''}`);
    return 1;
  }

  return write(kind, name, flags, kinds, tag) ? 0 : 1;
}

/** Every primitive geometry, skipping any the project already has. */
function createAll(names: readonly string[], flags: Flags, kinds: readonly AssetKind[]): number {
  let written = 0;
  for (const name of names) {
    const template = templateFor('asset', name, undefined, kinds);
    if (existsSync(resolve(flags.root, template.path))) continue;
    if (write('asset', name, flags, kinds)) written += 1;
  }
  if (written === 0) console.log('scenoco: every primitive geometry is already there.');
  return 0;
}

/** Write one starter document. False when it was refused. */
function write(kind: string, name: string, flags: Flags, kinds: readonly AssetKind[], tag?: string): boolean {
  const template = templateFor(kind, name, tag, kinds);
  const path = resolve(flags.root, template.path);
  if (existsSync(path)) {
    // Never silently: a starter document overwriting real work is unrecoverable.
    console.error(`scenoco new: ${relative(flags.root, path)} already exists.`);
    return false;
  }
  if (template.contents === undefined) {
    console.error(`scenoco new: ${template.problem}`);
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

/**
 * Which compiler this is, and where it was run from.
 *
 * Both halves matter: the version says what vocabulary to expect, and the directory says *which*
 * copy answered — the one in the project, or one a level up.
 */
function identity(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifest = resolve(here, '..', 'package.json');
  const version = existsSync(manifest)
    ? (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version
    : undefined;
  return `@scenoco-three/compiler ${version ?? '(unknown version)'} · ${dirname(manifest)}`;
}

function help(): void {
  // The kinds you can actually make *here* — help printed in a project with a VFX package should
  // list its documents, and outside a project the builtins are the honest answer.
  const kinds = documentKinds(process.cwd());
  const width = Math.max(...kinds.map((k) => k.kind.length));
  console.log(`scenoco — compile SceNoCo documents to TypeScript

  scenoco build [dir]     compile every document in the project
  scenoco watch [dir]     compile, then recompile as documents and components change
  scenoco watch -- <cmd>  the same, running <cmd> beside it: scenoco watch -- vite
  scenoco check [dir]     compile without writing — for CI
  scenoco init <dir>      a whole project that runs: scene, component, shapes, a bundler
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
${kinds.map((k) => `  ${k.kind.padEnd(width)}  ${k.description}`).join('\n')}
`);
}

/**
 * A scene the app never reaches — no import leads to it from the page's entry — never runs. The
 * observer opens a document, not the app, so a whole game built in `game.scene.xml` and checked
 * there can ship while `main.ts` still loads the starter's scene — a build did exactly that. A
 * note, not a failure: a spare scene is no error.
 *
 * Followed through the module graph, from the module scripts `index.html` loads (else
 * `src/main.ts`), across the project's sources and the generated documents — so a level another
 * level loads counts, and a scene only mentioned somewhere does not.
 */
function unloadedScenes(root: string, generated: ReadonlyMap<string, string>): string[] {
  const reached = new Set<string>();
  const queue = entryModules(root, generated);
  if (queue.length === 0) return [];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    const text = generated.get(file) ?? readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORTS)) {
      const specifier = match[1] ?? match[2] ?? match[3]!;
      if (!specifier.startsWith('.')) continue;
      const target = moduleAt(resolve(dirname(file), specifier), generated);
      if (target) queue.push(target);
    }
  }
  const notes: string[] = [];
  for (const file of generated.keys()) {
    if (!file.endsWith('.scene.gen.ts') || reached.has(file)) continue;
    const document = relative(root, file).replace(/\.gen\.ts$/, '.xml');
    notes.push(`note: ${document} is loaded by nothing (no import reaches it from the app's entry), so it never runs: src/main.ts decides which scene loads.`);
  }
  return notes;
}

/** `import … from '…'`, `export … from '…'`, `import('…')`, `import '…'`. */
const IMPORTS = /\b(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;

/** The modules the page starts from: `index.html`'s module scripts, else `src/main.ts`. */
function entryModules(root: string, generated: ReadonlyMap<string, string>): string[] {
  const page = join(root, 'index.html');
  const scripts = existsSync(page)
    ? [...readFileSync(page, 'utf8').matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]!)
    : [];
  const entries = scripts.flatMap((src) => moduleAt(join(root, src), generated) ?? []);
  if (entries.length > 0) return entries;
  const main = moduleAt(join(root, 'src', 'main'), generated);
  return main ? [main] : [];
}

/** The file an import names — `./a.js` is `a.ts` in source — or undefined outside the project. */
function moduleAt(path: string, generated: ReadonlyMap<string, string>): string | undefined {
  const candidates = [path, path.replace(/\.js$/, '.ts'), path.replace(/\.js$/, '.tsx'), `${path}.ts`, join(path, 'index.ts')];
  return candidates.find((file) => generated.has(file) || (existsSync(file) && lstatSync(file).isFile()));
}

