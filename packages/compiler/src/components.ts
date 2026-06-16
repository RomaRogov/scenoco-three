import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Registry,
  getNodeDef,
  getAttachmentDef,
  nodeTags,
  attachmentTags,
  unregisterNode,
} from '@scenoco-three/core/internal';
import { build } from 'esbuild';

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
}

// A file is loadable if it declares a component or a node tag; both register by
// importing the module (class-decorator side effect). One idiom, one scan.
const DECORATOR_RE = /@component\s*\(/;
const NODE_DECORATOR_RE = /@(?:node|attachment|system)\s*\(/;
const SYSTEM_RE = /@system\s*\(/;
// Matches @component({ name: 'X' …) and @node|attachment({ name: 'X' …}).
// `name` is always an explicit string literal (the registry contract), making a
// static name→file map possible without executing anything. (@system keys off a
// component type, not a tag name, so it has no name to extract.)
const NAME_RE = /@component\s*\(\s*\{[^}]*?name\s*:\s*['"`]([^'"`]+)['"`]/g;
const TAG_RE = /@(?:node|attachment)\s*\(\s*\{[^}]*?name\s*:\s*['"`]([^'"`]+)['"`]/g;
const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'demo', 'coverage', '.scenoco']);

/** Find files declaring `@component` classes / custom node tags, and their names. */
export function scanComponents(roots: string[], cwd = process.cwd()): ComponentScan {
  const files = new Map<string, string[]>();
  const byName = new Map<string, string>();
  const byTag = new Map<string, string>();

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
        if (names.length === 0 && tags.length === 0) {
          // A file with @system but no @component/@node is a silent failure —
          // the bundle plugin scanner never imports it. Warn so the author knows
          // to co-locate the @system with its entity @component.
          if (SYSTEM_RE.test(source)) {
            const rel = filePath.replace(cwd + '/', '');
            console.warn(
              `[scenoco] WARNING: ${rel} declares @system but has no @component or @node —` +
                ` it will NOT be imported by the bundle plugin.\n` +
                `  → Co-locate @system(T) in the same file as @component T.`,
            );
          }
          continue;
        }
        files.set(filePath, [...names, ...tags]);
        for (const name of names) byName.set(name, filePath);
        for (const tag of tags) byTag.set(tag, filePath);
      }
    }
  }
  return { files, byName, byTag };
}

// Per-process load state. The registration set is loaded as ONE module (a
// synthetic entry importing every declaring file), so files that import each
// other — `Follow` referencing `Oscillator` for a typed @property — share one
// evaluation and register exactly once. Any change reloads the whole set.
let loadedKey = '';
let ownedNames: string[] = [];
let ownedTags: string[] = [];

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

  // Retire the previous project set so the fresh module registers cleanly. A
  // genuine duplicate name/tag across two files still fails inside the new eval.
  for (const name of ownedNames) Registry.unregisterComponent(name);
  for (const tag of ownedTags) unregisterNode(tag);
  ownedNames = [];
  ownedTags = [];
  loadedKey = '';

  if (files.length > 0) {
    await importComponentSet(files, key, cwd, options.packages ?? []);
    ownedNames = projectNames;
    ownedTags = projectTags;
    loadedKey = key;
  }
  return scan;
}

// Tag packages, imported once each; we diff the registries to learn which tags
// each package contributes so the scan can map them to the package specifier.
const packageRegistrations = new Map<string, { names: string[]; tags: string[] }>();

async function registerPackages(packages: string[], scan: ComponentScan): Promise<void> {
  for (const pkg of packages) {
    let reg = packageRegistrations.get(pkg);
    if (!reg) {
      const beforeNames = new Set(Registry.componentNames());
      const beforeTags = new Set([...nodeTags(), ...attachmentTags()]);
      const mod = (await import(pkg)) as { sceneTags?: string[] };
      // A tag package may export `sceneTags` (authoritative — works even if it
      // was already imported); otherwise diff the registries for what it added.
      if (mod.sceneTags) {
        reg = {
          names: mod.sceneTags.filter((t) => Registry.getComponent(t) !== undefined),
          tags: mod.sceneTags.filter((t) => getNodeDef(t) !== undefined || getAttachmentDef(t) !== undefined),
        };
      } else {
        const after = new Set([...nodeTags(), ...attachmentTags()]);
        reg = {
          names: Registry.componentNames().filter((n) => !beforeNames.has(n)),
          tags: [...after].filter((t) => !beforeTags.has(t)),
        };
      }
      packageRegistrations.set(pkg, reg);
    }
    for (const n of reg.names) scan.byName.set(n, pkg);
    for (const t of reg.tags) scan.byTag.set(t, pkg);
  }
}

/**
 * Transpile + import the component set as one ES module. esbuild bundles a
 * synthetic entry that imports every component file, with `@scenoco-three/core` and
 * `three` left external so the module registers into the *same* Registry
 * instance the compiler uses. The result is cached under
 * `.scenoco/component-cache`, content-addressed by the set's path+mtime key.
 */
async function importComponentSet(
  files: string[],
  key: string,
  cwd: string,
  extraExternals: string[] = [],
): Promise<void> {
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
      sourcemap: false,
      logLevel: 'silent',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    });
    const code = bundled.outputFiles[0]?.text;
    if (!code) throw new Error('esbuild produced no output for the component set');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachedModulePath, code);
  }

  await import(pathToFileURL(cachedModulePath).href);
}
