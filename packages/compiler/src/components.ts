import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Registry,
  getNodeDef,
  getAttachmentDef,
  nodeTags,
  attachmentTags,
  unregisterNode,
} from '@scenoco-three/core/internal';
import { build, type Loader } from 'esbuild';

/**
 * Project component AND node discovery and Node-side loading.
 *
 * Scenes reference components by tag (`<Rotator …/>`) and use node tags
 * (`<Mesh>`, a custom `<MyWidget>`); the validator, compiler, and exporters
 * resolve those against the @scenoco-three/core registries, which are populated
 * by *importing* the files that declare them — `@component` classes and
 * `define{Node,Geometry,Material,Setting}(…)` calls. At build time those are the
 * project's TypeScript sources, so this module finds them, transpiles them with
 * esbuild (cached under `.scenoco/component-cache`), and imports them into the
 * current Node process. The CLI and the Vite plugin both run on top of this.
 *
 * Re-loading: when a file's mtime changes, its previously registered names are
 * unregistered first, so long-running processes (dev server, watch) always
 * validate against the file's current contents.
 */

export interface ComponentScan {
  /** Absolute file path → the component names + node tags the file declares. */
  files: Map<string, string[]>;
  /** Component name → the absolute file path that declares it. */
  byName: Map<string, string>;
  /** Node/geometry/material/setting tag → the absolute file that declares it. */
  byTag: Map<string, string>;
  /**
   * Component type a `@system(T)` processes → the file(s) declaring that system.
   * Lets the bundle plugin ship a system's module whenever `T` is used — even
   * when the `@system` lives in its own file (not co-located with `@component T`),
   * which would otherwise be silently never imported.
   */
  byComponentSystem: Map<string, string[]>;
}

// A file is loadable if it declares a component or a node tag; both register by
// importing the module (class-decorator side effect). One idiom, one scan.
const DECORATOR_RE = /@component\s*\(/;
const NODE_DECORATOR_RE = /@(?:node|attachment|system)\s*\(/;
const SYSTEM_RE = /@system\s*\(/;
// Matches @component({ name: 'X' …) and @node|attachment({ name: 'X' …}).
// `name` is always an explicit string literal (the registry contract), making a
// static name→file map possible without executing anything.
const NAME_RE = /@component\s*\(\s*\{[^}]*?name\s*:\s*['"`]([^'"`]+)['"`]/g;
const TAG_RE = /@(?:node|attachment)\s*\(\s*\{[^}]*?name\s*:\s*['"`]([^'"`]+)['"`]/g;
// The component identifier a `@system(T)` processes. By this repo's convention a
// component class's name equals its registered XML `name` (RigidBody → 'RigidBody'),
// so this identifier is the scene component type the system should ship with.
const SYSTEM_IDENT_RE = /@system\s*\(\s*([A-Za-z_$][\w$]*)/g;
const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'demo', 'coverage', '.scenoco']);

// Binary asset extensions a component might `import` — loaded as data URIs so the
// Node-side registration import succeeds (the bytes are never used, only the
// module's decorator side effects). Mirrors what the Vite app build inlines.
const ASSET_LOADERS: Record<string, Loader> = Object.fromEntries(
  ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ktx2', '.basis', '.hdr', '.exr', '.glb', '.gltf', '.fbx', '.obj', '.bin', '.mp3', '.ogg', '.wav', '.m4a', '.woff', '.woff2', '.ttf'].map((ext) => [ext, 'dataurl' as Loader]),
);

/** Toolchain/runtime `@scenoco-three/*` packages that don't contribute scene tags. */
const NON_TAG_PACKAGES = new Set([
  '@scenoco-three/core',
  '@scenoco-three/compiler',
  '@scenoco-three/vite',
  '@scenoco-three/editor',
]);

/**
 * Tag packages a project depends on — read straight from its `package.json`, so
 * the editor and Vite plugin can register them **without an explicit list**. Every
 * `@scenoco-three/*` dependency except the toolchain/runtime qualifies
 * (`rapier`/`box2d`/`collision`/`ui`/`audio`/`animation` …); each exports
 * `sceneTags`, which `registerPackages` reads. Returns `[]` when there's no
 * `package.json`.
 */
export function detectTagPackages(cwd = process.cwd()): string[] {
  const pkgPath = resolve(cwd, 'package.json');
  if (!existsSync(pkgPath)) return [];
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg;
  } catch {
    return [];
  }
  const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  return [...names].filter((n) => n.startsWith('@scenoco-three/') && !NON_TAG_PACKAGES.has(n));
}

/** Find files declaring `@component` classes / custom node tags, and their names. */
export function scanComponents(roots: string[], cwd = process.cwd()): ComponentScan {
  const files = new Map<string, string[]>();
  const byName = new Map<string, string>();
  const byTag = new Map<string, string>();
  const byComponentSystem = new Map<string, string[]>();
  const mapSystem = (component: string, file: string): void => {
    const arr = byComponentSystem.get(component);
    if (arr) arr.push(file);
    else byComponentSystem.set(component, [file]);
  };

  for (const root of roots) {
    const absRoot = resolve(cwd, root);
    if (!existsSync(absRoot)) continue;
    const stack = [absRoot];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) stack.push(resolve(dir, entry.name));
          continue;
        }
        if (!SOURCE_EXT_RE.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
        const filePath = resolve(dir, entry.name);
        const source = readFileSync(filePath, 'utf8');
        const hasComponent = DECORATOR_RE.test(source);
        const hasNode = NODE_DECORATOR_RE.test(source);
        if (!hasComponent && !hasNode) continue;
        const names = hasComponent ? [...source.matchAll(NAME_RE)].map((m) => m[1]!) : [];
        const tags = hasNode ? [...source.matchAll(TAG_RE)].map((m) => m[1]!) : [];
        // Component types each `@system(T)` in this file processes, so the file
        // ships whenever T is used (see byComponentSystem). Covers both a stand-
        // alone @system file and a system co-located with an unrelated component.
        const systemComponents = SYSTEM_RE.test(source)
          ? [...source.matchAll(SYSTEM_IDENT_RE)].map((m) => m[1]!)
          : [];
        if (names.length === 0 && tags.length === 0) {
          // A file declaring only @system(T) (no tag of its own). Without a tag
          // name the usage-based bundle plugin can't key it — so map it under the
          // component types it processes and register it Node-side (empty tag list).
          if (systemComponents.length > 0) {
            files.set(filePath, []);
            for (const comp of systemComponents) mapSystem(comp, filePath);
          }
          continue;
        }
        files.set(filePath, [...names, ...tags]);
        for (const name of names) byName.set(name, filePath);
        for (const tag of tags) byTag.set(tag, filePath);
        for (const comp of systemComponents) mapSystem(comp, filePath);
      }
    }
  }
  return { files, byName, byTag, byComponentSystem };
}

// Per-process load state. The registration set is loaded as ONE module (a
// synthetic entry importing every declaring file), so files that import each
// other — `Follow` referencing `Oscillator` for a typed @property — share one
// evaluation and register exactly once. Any change reloads the whole set.
let loadedKey = '';
let ownedNames: string[] = [];
let ownedTags: string[] = [];

/** A failed component (re)load — the transpile/eval error and the files involved. */
export interface ComponentLoadError {
  message: string;
  files: string[];
}
let loadError: ComponentLoadError | undefined;

/**
 * The last component (re)load failure, or `undefined` if the current registry is
 * healthy. A failed reload keeps the previous (last-good) registrations live, so a
 * long-running host (the editor, a watch server) stays usable; this reports *that*
 * a set is broken (and how) so it can be surfaced to the user and cleared on fix.
 */
export function componentLoadError(): ComponentLoadError | undefined {
  return loadError;
}

export interface LoadOptions {
  /**
   * npm packages that register tags (components/nodes/settings) on import, e.g.
   * `['@scenoco-three/rapier']`. They are imported once to register their tags
   * in this process, and mapped into the scan so the Vite plugin usage-ships
   * them (a scene that uses `<RigidBody>` imports the package; others don't).
   */
  packages?: string[];
}

/**
 * Ensure every `@component` and custom node declared under `roots` (plus any tag
 * `packages`) is registered in this process's registries. Idempotent and
 * change-aware: if nothing changed it's a cheap scan; if anything changed,
 * previous registrations are retired and the fresh set is imported. Returns the
 * scan so callers can map names/tags to files/packages (for usage-based imports).
 */
export async function loadComponents(
  roots: string[],
  cwd = process.cwd(),
  options: LoadOptions = {},
): Promise<ComponentScan> {
  const scan = scanComponents(roots, cwd);
  // Project file names/tags only — package registrations persist across reloads
  // (npm deps are stable; ESM caches the import), so they're never retired.
  const projectNames = [...scan.byName.keys()];
  const projectTags = [...scan.byTag.keys()];
  await registerPackages(options.packages ?? [], scan);

  const files = [...scan.files.keys()].sort();
  const key = createHash('sha1')
    .update(files.map((f) => `${f}:${statSync(f).mtimeMs}`).join('|'))
    .digest('hex');
  if (key === loadedKey) return scan;

  // Transpile the fresh set FIRST — a corruption (syntax/type/unresolved-import
  // error) throws here, *before* we touch the live registry, so the last-good set
  // stays registered and the host keeps working. `loadedKey` is left unchanged, so
  // the next change (a new key) retries automatically — an auto-recovery on fix.
  let modulePath = '';
  if (files.length > 0) {
    try {
      modulePath = await buildComponentSet(files, key, cwd, options.packages ?? []);
    } catch (e) {
      loadError = { message: errorText(e), files };
      return scan;
    }
  }

  // Transpile OK — swap in the fresh set: retire the previous, evaluate the new. A
  // genuine duplicate name/tag across two files still fails inside the new eval.
  for (const name of ownedNames) Registry.unregisterComponent(name);
  for (const tag of ownedTags) unregisterNode(tag);
  ownedNames = [];
  ownedTags = [];
  loadedKey = '';

  try {
    if (modulePath) await importBuiltSet(modulePath);
    ownedNames = projectNames;
    ownedTags = projectTags;
    loadedKey = key;
    loadError = undefined;
  } catch (e) {
    // Rare: the set transpiled but threw while evaluating (e.g. a decorator
    // validation error or a duplicate registration). Clear any partials so the
    // registry is consistent; the process stays alive with the error recorded.
    for (const name of projectNames) Registry.unregisterComponent(name);
    for (const tag of projectTags) unregisterNode(tag);
    loadError = { message: errorText(e), files };
  }
  return scan;
}

/** Format a load failure — esbuild collects errors on `.errors`; else the message. */
function errorText(e: unknown): string {
  const errs = (e as { errors?: { text: string; location?: { file: string; line: number } | null }[] }).errors;
  if (Array.isArray(errs) && errs.length > 0) {
    return errs.map((x) => (x.location ? `${x.location.file}:${x.location.line}: ${x.text}` : x.text)).join('\n');
  }
  return e instanceof Error ? e.message : String(e);
}

// Tag packages, imported once each; we diff the registries to learn which tags
// each package contributes so the scan can map them to the package specifier.
interface PackageRegistration {
  names: string[];
  tags: string[];
  /** Package-owned XSDs (see `SchemaFile`) resolved to absolute paths. */
  schemas: SchemaFile[];
}
const packageRegistrations = new Map<string, PackageRegistration>();

/** A package-shipped XSD to publish on `scenoco export`. */
export interface SchemaFile {
  /** The output filename in the schema dir, e.g. `particle.xsd`. */
  filename: string;
  /** The absolute path to the shipped source file. */
  path: string;
}

async function registerPackages(packages: string[], scan: ComponentScan): Promise<void> {
  for (const pkg of packages) {
    let reg = packageRegistrations.get(pkg);
    if (!reg) {
      const beforeNames = new Set(Registry.componentNames());
      const beforeTags = new Set([...nodeTags(), ...attachmentTags()]);
      const mod = (await import(pkg)) as { sceneTags?: string[]; schemas?: readonly string[] };
      // A tag package may export `sceneTags` (authoritative — works even if it
      // was already imported); otherwise diff the registries for what it added.
      if (mod.sceneTags) {
        reg = {
          names: mod.sceneTags.filter((t) => Registry.getComponent(t) !== undefined),
          tags: mod.sceneTags.filter((t) => getNodeDef(t) !== undefined || getAttachmentDef(t) !== undefined),
          schemas: resolvePackageSchemas(pkg, mod.schemas ?? []),
        };
      } else {
        const after = new Set([...nodeTags(), ...attachmentTags()]);
        reg = {
          names: Registry.componentNames().filter((n) => !beforeNames.has(n)),
          tags: [...after].filter((t) => !beforeTags.has(t)),
          schemas: resolvePackageSchemas(pkg, mod.schemas ?? []),
        };
      }
      packageRegistrations.set(pkg, reg);
    }
    for (const n of reg.names) scan.byName.set(n, pkg);
    for (const t of reg.tags) scan.byTag.set(t, pkg);
  }
}

/**
 * The package-owned XSDs collected across every registered tag package (deduped
 * by filename). `scenoco export` copies each into the project's schema dir. Empty
 * until `loadComponents`/`scanComponents` has imported the packages.
 */
export function collectedPackageSchemas(): SchemaFile[] {
  const out = new Map<string, SchemaFile>();
  for (const reg of packageRegistrations.values()) {
    for (const s of reg.schemas) out.set(s.filename, s);
  }
  return [...out.values()];
}

/** Resolve a package's declared XSD filenames to absolute paths in its install dir. */
function resolvePackageSchemas(pkg: string, filenames: readonly string[]): SchemaFile[] {
  if (filenames.length === 0) return [];
  const root = packageRoot(pkg);
  if (!root) return [];
  return filenames
    .map((filename) => ({ filename, path: join(root, filename) }))
    .filter((s) => existsSync(s.path));
}

/** The install directory of a package (the dir whose package.json is that package). */
function packageRoot(pkg: string): string | undefined {
  let dir: string;
  try {
    // ESM resolution (honors the package's `exports` `import` condition, unlike
    // `require.resolve`, which fails on import-only `exports`).
    dir = dirname(fileURLToPath(import.meta.resolve(pkg)));
  } catch {
    return undefined;
  }
  for (let i = 0; i < 8; i++) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        if ((JSON.parse(readFileSync(pj, 'utf8')) as { name?: string }).name === pkg) return dir;
      } catch {
        /* keep walking up */
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

/**
 * Transpile the component set to one ES module and return its path — WITHOUT
 * evaluating it. esbuild bundles a synthetic entry that imports every declaring
 * file, with `@scenoco-three/core` and `three` left external so evaluation later
 * registers into the *same* Registry instance the compiler uses. The result is
 * cached under `.scenoco/component-cache`, content-addressed by the set's
 * path+mtime key. Splitting build from eval lets `loadComponents` catch a
 * transpile error before it disturbs the live registry (see the last-good path).
 */
async function buildComponentSet(files: string[], key: string, cwd: string, extraExternals: string[] = []): Promise<string> {
  const cacheDir = resolve(cwd, '.scenoco', 'component-cache');
  const cachedModulePath = resolve(cacheDir, `${key}.mjs`);

  if (!existsSync(cachedModulePath)) {
    const entry = files.map((f) => `import ${JSON.stringify(f)};`).join('\n');
    const bundled = await build({
      stdin: { contents: entry, resolveDir: cwd, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      // tag packages (e.g. @scenoco-three/rapier) must be external — they are
      // already imported by registerPackages() and registered in the runtime
      // Registry; bundling them again causes "already registered" errors.
      external: ['@scenoco-three/core', 'three', ...extraExternals],
      // A component may import a binary asset (`import url from './sprite.png'`),
      // which the Vite app build inlines but esbuild has no default loader for.
      // We only need the module to *register* — the bytes are irrelevant here —
      // so pass assets through as data URIs (self-contained, no emit dir), matching
      // Vite's inlining. Without this, a scene using such a component fails to
      // validate/bundle/export even though the app builds fine.
      loader: ASSET_LOADERS,
      sourcemap: false,
      logLevel: 'silent',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    });
    const code = bundled.outputFiles[0]?.text;
    if (!code) throw new Error('esbuild produced no output for the component set');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachedModulePath, code);
  }
  return cachedModulePath;
}

/** Evaluate a built component module (runs the decorator registrations). */
async function importBuiltSet(modulePath: string): Promise<void> {
  await import(pathToFileURL(modulePath).href);
}
