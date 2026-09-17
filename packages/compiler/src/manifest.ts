import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AssetKind, FileKind } from './assets.js';
import { BUILTIN_FILE_KINDS, BUILTIN_KINDS } from './assets.js';

/**
 * What a package tells the toolchain about itself, in its own `package.json`.
 *
 * A module is a package with a `"scenoco"` block. That is the whole test — which is what lets a
 * package outside this scope be one, and what replaced a deny-list of our own package names that
 * every new toolchain package had to be added to.
 *
 * The block is deliberately thin. A document kind is a **file extension and a type name**: what
 * elements the document has, what attributes each takes and what they accept all come from that
 * type's own declaration, exactly as a tag's attributes come from a three.js constructor. The
 * things that stay here are the ones no type could answer — where on disk the files live, and
 * which suffix is theirs.
 *
 * ```jsonc
 * "scenoco": {
 *   "documents": [{ "extension": ".particle.xml", "type": "ParticleEffect", "dir": "assets/vfx" }],
 *   "files": [{ "extensions": ["mp3"], "helper": "sharedClip", "suffix": "Clip", "await": true }],
 *   "notes": { "Canvas": "prose for `scenoco describe`" },
 *   "editor": "./dist/editor.js"
 * }
 * ```
 *
 * It is read with `readFileSync`, before anything else — because which files in a project are
 * documents at all is a question `findAssets` asks before a TypeScript workspace exists, and
 * `scenoco new` never opens one.
 */
export interface ModuleManifest {
  /** Package name, which is also the specifier a generated import writes. */
  name: string;
  /** Absolute, symlink-resolved package directory. */
  dir: string;
  /** Version as declared, for whoever reports what a project is built from. */
  version?: string;
  documents: readonly AssetKind[];
  files: readonly FileKind[];
  /** Per-tag prose for `scenoco describe`, by tag name. */
  notes: Readonly<Record<string, string>>;
  /**
   * What a component looks like in an editor, by component name.
   *
   * A component's effect is usually only visible in the running game — a script icon is all any
   * editor can honestly show. A **preview** is the exception, for the component whose whole job is
   * to put geometry in the world: it names a module whose default export turns the component's
   * authored attributes into an `Object3D`, and an editor draws that where the node is.
   *
   * The contract is deliberately tiny, and every part of it is load-bearing:
   *
   * - **A pure function.** `(props) => Object3D | null`. No lifecycle, no scene, no engine. There
   *   is nothing for it to corrupt and nothing to undo — which is what separates this from running
   *   game code in an editor, and from the list of caveats that comes with doing so.
   * - **One file, loadable as it stands.** An editor is a page, not a build; it can fetch a module
   *   and import it, and that is all. So a preview is JavaScript, not TypeScript, and imports
   *   nothing but `three` — the one dependency an editor certainly has.
   */
  previews: Readonly<Record<string, string>>;
  /** A single ESM bundle the standalone editor may load to construct this package's tags. */
  editor?: string;
}

export interface ModuleManifests {
  modules: readonly ModuleManifest[];
  /** Declared dependencies whose `package.json` could not be read — probably not installed. */
  missing: readonly string[];
  /**
   * The project's own `"scenoco"` block, when it has one.
   *
   * A project declares things about itself in the same place a package does — it has a
   * `package.json` too. Kept apart from `modules` because it is not a module *specifier*: nothing
   * imports the project by name, so it can carry a preview but not a document kind, whose type has
   * to be read from a module something imports.
   */
  project?: ModuleManifest;
}

/**
 * Every module a project depends on, with what each declares.
 *
 * Direct dependencies only: a package that re-exports another does not bring its kinds along,
 * because a document kind is something a project opts into by depending on it.
 */
export function readModuleManifests(root: string): ModuleManifests {
  const manifest = resolve(root, 'package.json');
  if (!existsSync(manifest)) return { modules: [], missing: [] };
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8')) as typeof pkg;
  } catch {
    return { modules: [], missing: [] }; // an unreadable manifest is not a reason to refuse to compile
  }

  const names = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])].sort();
  const modules: ModuleManifest[] = [];
  const missing: string[] = [];

  for (const name of names) {
    const dir = packageDirOf(name, root);
    if (!dir) {
      missing.push(name);
      continue;
    }
    let declared: { version?: string; scenoco?: unknown };
    try {
      declared = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as typeof declared;
    } catch {
      missing.push(name);
      continue;
    }
    if (!declared.scenoco || typeof declared.scenoco !== 'object') continue; // not a module
    modules.push(readOne(name, dir, declared.version, declared.scenoco as Record<string, unknown>));
  }

  claim(modules);
  return { modules, missing, ...(own(root, manifest) ?? {}) };
}

/** The project's own declarations, read from the manifest already parsed above. */
function own(root: string, manifestPath: string): { project: ModuleManifest } | undefined {
  let pkg: { name?: string; version?: string; scenoco?: unknown };
  try {
    pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof pkg;
  } catch {
    return undefined;
  }
  if (!pkg.scenoco || typeof pkg.scenoco !== 'object') return undefined;
  const project = readOne(pkg.name ?? 'this project', root, pkg.version, pkg.scenoco as Record<string, unknown>);
  return { project };
}

/** Every preview any manifest declares, by component name. */
export function previewsOf(manifests: readonly ModuleManifest[]): Array<{ component: string; owner: ModuleManifest; path: string }> {
  return manifests.flatMap((owner) =>
    Object.entries(owner.previews).map(([component, path]) => ({ component, owner, path })),
  );
}

/**
 * Where a package's own directory is.
 *
 * The walk up `node_modules` rather than `require.resolve`, for two reasons that both bite here:
 * a package whose `exports` map has only a `"."` entry — which is all of ours — refuses
 * `require.resolve('pkg/package.json')` outright, and resolving the *entry point* instead leaves
 * you guessing how deep inside the package it sits. The walk also matches how a workspace looks:
 * an example here has no `node_modules` of its own and resolves in the repository root's, where
 * every package is a symlink into `packages/`.
 */
function packageDirOf(name: string, from: string): string | undefined {
  const segments = name.split('/');
  for (let at = resolve(from); ; ) {
    const candidate = join(at, 'node_modules', ...segments);
    if (existsSync(join(candidate, 'package.json'))) {
      try {
        // Through the link: a `template` path is read from here, and two projects reaching one
        // package must agree on where it is.
        return realpathSync(candidate);
      } catch {
        return candidate;
      }
    }
    const parent = dirname(at);
    if (parent === at) return undefined;
    at = parent;
  }
}

function readOne(
  name: string,
  dir: string,
  version: string | undefined,
  block: Record<string, unknown>,
): ModuleManifest {
  const documents = asArray(block.documents).map((entry, index) => document(name, entry, index, dir));
  const files = asArray(block.files).map((entry, index) => file(name, entry, index));
  const notes: Record<string, string> = {};
  if (block.notes && typeof block.notes === 'object') {
    for (const [tag, text] of Object.entries(block.notes as Record<string, unknown>)) {
      // A list of lines, because prose in a JSON string is one unreadable line, and this is prose
      // somebody has to maintain.
      if (Array.isArray(text)) notes[tag] = text.filter((line) => typeof line === 'string').join('\n');
      else if (typeof text === 'string') notes[tag] = text;
    }
  }
  const previews: Record<string, string> = {};
  if (block.previews && typeof block.previews === 'object') {
    for (const [component, path] of Object.entries(block.previews as Record<string, unknown>)) {
      if (typeof path === 'string') previews[component] = path;
      else throw refuse(`"${name}" declares a preview for ${component} that is not a path.`);
    }
  }

  return {
    name,
    dir,
    ...(version ? { version } : {}),
    documents,
    files,
    notes,
    previews,
    ...(typeof block.editor === 'string' ? { editor: block.editor } : {}),
  };
}

function document(name: string, entry: unknown, index: number, dir: string): AssetKind {
  const at = `documents[${index}]`;
  const value = object(name, entry, at);
  const extension = string(name, value.extension, `${at}.extension`);
  const type = string(name, value.type, `${at}.type`);

  // `.particle.xml` → `particle`. The kind is the word a person types after `scenoco new`, and
  // deriving it from the suffix is one fewer name to keep in step with itself.
  const match = /^\.([A-Za-z][A-Za-z0-9-]*)\.xml$/.exec(extension);
  if (!match) {
    throw refuse(
      `"${name}" declares the extension "${extension}", which is not a document suffix. ` +
        'Write it as ".<kind>.xml" — the word before ".xml" is the kind, as in ".particle.xml".',
    );
  }
  const kind = match[1]!;

  return {
    kind,
    extension,
    description: typeof value.description === 'string' ? value.description : `A ${kind} document, from ${name}`,
    dir: typeof value.dir === 'string' ? value.dir : `assets/${kind}`,
    package: { name, dir },
    type,
    ...(typeof value.template === 'string' ? { template: value.template } : {}),
  };
}

function file(name: string, entry: unknown, index: number): FileKind {
  const at = `files[${index}]`;
  const value = object(name, entry, at);
  const extensions = asArray(value.extensions).filter((e): e is string => typeof e === 'string');
  if (extensions.length === 0) throw missingField(name, `${at}.extensions`, 'at least one file extension');
  return {
    extensions: extensions.map((e) => e.replace(/^\./, '').toLowerCase()),
    // A package can only export its own helper, so restating the module here is a way to get it
    // wrong and nothing else.
    helper: { module: name, name: string(name, value.helper, `${at}.helper`) },
    suffix: typeof value.suffix === 'string' ? value.suffix : '',
    await: value.await === true,
  };
}

/**
 * Refuse two packages that claim the same thing.
 *
 * The same rule two packages claiming one tag name already follow, and for the same reason: which
 * of the two wins would decide what every document of that kind compiles to, and nothing in a
 * project says which was meant.
 */
function claim(modules: readonly ModuleManifest[]): void {
  const kinds = new Map<string, string>();
  const extensions = new Map<string, string>();
  const fileExtensions = new Map<string, string>();

  for (const builtin of BUILTIN_KINDS) {
    kinds.set(builtin.kind, 'the compiler');
    extensions.set(builtin.extension, 'the compiler');
  }
  for (const builtin of BUILTIN_FILE_KINDS) {
    for (const extension of builtin.extensions) fileExtensions.set(extension, 'the compiler');
  }

  for (const module of modules) {
    for (const kind of module.documents) {
      const owner = kinds.get(kind.kind);
      if (owner) {
        throw refuse(
          `the document kind "${kind.kind}" is declared by both ${owner === 'the compiler' ? 'the compiler' : `"${owner}"`} ` +
            `and "${module.name}". Two packages cannot claim one kind; rename one, or drop a dependency.`,
        );
      }
      const claimed = extensions.get(kind.extension);
      if (claimed) {
        throw refuse(
          `the extension "${kind.extension}" is claimed by both ${claimed === 'the compiler' ? 'the compiler' : `"${claimed}"`} ` +
            `and "${module.name}". One extension is one kind of document; rename one, or drop a dependency.`,
        );
      }
      kinds.set(kind.kind, module.name);
      extensions.set(kind.extension, module.name);
    }
    for (const kind of module.files) {
      for (const extension of kind.extensions) {
        const owner = fileExtensions.get(extension);
        if (owner) {
          throw refuse(
            `the file extension ".${extension}" is loaded by both ${owner === 'the compiler' ? 'the compiler' : `"${owner}"`} ` +
              `and "${module.name}". One extension is loaded one way; drop a dependency.`,
          );
        }
        fileExtensions.set(extension, module.name);
      }
    }
  }
}

/** Everything a project's documents may be: the builtin kinds, then what its modules declared. */
export function kindsOf(modules: readonly ModuleManifest[]): readonly AssetKind[] {
  return [...BUILTIN_KINDS, ...modules.flatMap((module) => module.documents)];
}

/** Every file a document may name directly: images and models, then what its modules load. */
export function fileKindsOf(modules: readonly ModuleManifest[]): readonly FileKind[] {
  return [...BUILTIN_FILE_KINDS, ...modules.flatMap((module) => module.files)];
}

/** Per-tag prose, merged across modules. */
export function notesOf(modules: readonly ModuleManifest[]): Record<string, string> {
  return Object.assign({}, ...modules.map((module) => module.notes)) as Record<string, string>;
}

/** The document kinds a project has, for a caller with nothing else to do first. */
export function documentKinds(root: string): readonly AssetKind[] {
  return kindsOf(readModuleManifests(root).modules);
}

function object(name: string, entry: unknown, at: string): Record<string, unknown> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw refuse(`"${name}" declares a "scenoco" block this compiler cannot read: ${at} is not an object.`);
  }
  return entry as Record<string, unknown>;
}

function string(name: string, value: unknown, at: string): string {
  if (typeof value !== 'string' || value === '') throw missingField(name, at, 'a name');
  return value;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function missingField(name: string, at: string, wanted: string): Error {
  return refuse(
    `"${name}" declares a "scenoco" block this compiler cannot read: ${at} needs ${wanted}. ` +
      'A document kind is an "extension" and the "type" whose declaration describes it.',
  );
}

function refuse(message: string): Error {
  return new Error(`[scenoco] ${message}`);
}
