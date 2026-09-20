import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { BUILTIN_FILE_KINDS, fileKindOf, findAssets, type AssetFile, type AssetKind, type FileKind } from './assets.js';
import { fileKindsOf, kindsOf, previewsOf, readModuleManifests, type ModuleManifests } from './manifest.js';
import { formatDiagnostic, type SncDiagnostic } from './dsl/diagnostics.js';
import { parseDocument, type SncElement } from './dsl/parse.js';
import { emitConfigDocument } from './emit/config.js';
import { emitGraph } from './emit/graph.js';
import type { ConfigType } from './emit/scope.js';
import { emitRender } from './emit/render.js';
import { emitTexture } from './emit/texture.js';
import type {
  AssetImport,
  FileImport,
  PrefabSurface,
  PrefabTarget,
  ResolveAsset,
} from './emit/assets.js';
import { camelCase, pascalCase } from './emit/module.js';
import { emitResource } from './emit/resource.js';
import { MODEL_FILE, PREVIEW_THREE, type DocumentShape, type ProjectModel } from './model.js';
import { scanConfigShape, shapeProblems, type ConfigShape } from './scan/interfaces.js';
import { Workspace } from './scan/workspace.js';
import { scanComponents, scanEffects, scanSystems } from './scan/components.js';
import { scanTags } from './scan/tags.js';
import { BUILTIN_DOCUMENT_TYPES } from './scan/shape.js';
import { classSources, scanProject } from './scan/project.js';

export interface BuildOptions {
  /** Project root — the directory holding `tsconfig.json` and `assets/`. */
  root: string;
  /** Defaults to `<root>/tsconfig.json`. */
  tsconfig?: string;
  /**
   * Modules whose tags the DSL accepts. Defaults to `three` plus the project's own SceNoCo
   * dependencies — pass a list only to compile against something narrower or wider than what the
   * project declares.
   */
  modules?: readonly string[];
  /** Report what would be written without touching the disk. */
  dryRun?: boolean;
  /** Reuse an already-scanned model — the watcher does, so it scans once per change. */
  model?: ProjectModel;
  /**
   * The document kinds this project has. Defaults to the builtins plus whatever its packages
   * declare; pass a list to compile against something else.
   */
  kinds?: readonly AssetKind[];
  /**
   * Config shapes from a previous build, by kind — feed `BuildResult.shapes` back and a rebuild
   * opens no TypeScript workspace at all. Cache it with `model`, and drop it with `model`: both
   * are read from the same declarations.
   */
  shapes?: ReadonlyMap<string, ConfigShape | undefined>;
  /**
   * Stamp every node with the document and line it came from (`userData.scenoco`), so an editor
   * can map a live object back to the element that made it. Dev only — `scenoco()` turns it on
   * while Vite is serving and off when it builds.
   */
  provenance?: boolean;
}

export interface BuildResult {
  /** Generated files, absolute path → source. */
  files: Map<string, string>;
  diagnostics: SncDiagnostic[];
  model: ProjectModel;
  /** What this project's documents may be — the builtins plus what its packages declared. */
  kinds: readonly AssetKind[];
  /** The config shapes this build read. Pass back as `options.shapes` alongside `model`. */
  shapes: ReadonlyMap<string, ConfigShape | undefined>;
}

/**
 * Compile every XML document in a project to TypeScript.
 *
 * The generated files are build artifacts: they sit beside their source, they are regenerated
 * whenever the XML or a component changes, and they belong in `.gitignore`. The XML stays the
 * thing a person or an editor edits — this is a compiler, not a one-way migration.
 */
export function build(options: BuildOptions): BuildResult {
  const root = resolve(options.root);
  const tsconfig = options.tsconfig ?? resolve(root, 'tsconfig.json');
  // What this project's packages say they are. A module is a dependency with a `"scenoco"` block,
  // and that one question answers three: which tags the DSL accepts, which files are documents,
  // and which raw files load into what.
  const installed = readModuleManifests(root);
  const kinds = options.kinds ?? kindsOf(installed.modules);
  const fileKinds = options.kinds ? BUILTIN_FILE_KINDS : fileKindsOf(installed.modules);
  // A project that depends on a module means to use it; asking for the list again on the command
  // line only creates a way for the two to disagree.
  const modules = options.modules ?? ['three', ...installed.modules.map((module) => module.name)];
  // Installed, not read: a runtime dependency with no `"scenoco"` block contributes no vocabulary,
  // which is why a tag it obviously ships still comes back unknown.
  const plainPackages = installed.plain.filter((name) => !modules.includes(name));
  const { documents: assets, unclaimed } = findAssets(root, kinds);
  const byKind = new Map(kinds.map((kind) => [kind.kind, kind]));

  // A config shape is read from whichever package declares it — every declared kind, not only the
  // ones this project already holds a document of, because the model written below is what an
  // editor reads and it has to be able to offer the *first* `.particle.xml` in a project.
  // `has`, not truthiness: a kind that failed to resolve has to remember that it tried, or every
  // rebuild reopens a workspace to fail the same way.
  const shapes = new Map(options.shapes ?? []);
  const unscanned = kinds.filter((kind) => kind.type && !shapes.has(kind.kind));

  // A field typed by a document kind's own type is written as a *path* to one of those documents,
  // the same way `scene!: SceneType` is. Which types those are is what the packages just said.
  const documents = new Set([
    ...BUILTIN_DOCUMENT_TYPES,
    ...kinds.flatMap((kind) => (kind.type ? [kind.type] : [])),
  ]);

  let model = options.model;
  if (!model || unscanned.length > 0) {
    Workspace.with(
      tsconfig,
      (workspace) => {
        const packages = classSources(modules);
        model ??= {
          components: scanComponents(workspace, packages, documents),
          systems: scanSystems(workspace, packages, documents),
          effects: scanEffects(workspace, packages, documents),
          tags: scanTags(workspace, modules, documents),
        };
        for (const kind of unscanned) {
          shapes.set(kind.kind, scanConfigShape(workspace, moduleOf(kind), kind.type!, documents));
        }
      },
      root,
    );
  }
  model ??= scanProject(tsconfig, { cwd: root, modules });

  // The same shapes, keyed the way a *document* names one: by the type, which is the element.
  // A kind is how a file is found; a type is what an element inside another document is called.
  const configs = new Map<string, ConfigType>();
  for (const kind of kinds) {
    const shape = kind.type ? shapes.get(kind.kind) : undefined;
    if (shape) configs.set(shape.name, { shape, module: moduleOf(kind) });
  }

  const exports = new Map<string, AssetImport>(); // absolute xml path → what it exports
  const files = new Map<string, string>();
  const diagnostics: SncDiagnostic[] = [];

  // A document of a kind nothing declares. Walking past it silently is the one failure worse than
  // refusing to compile: no output, no message, and the breakage lands wherever the value was
  // named. Line 1 because there is nothing in the file to blame — the project is missing a package.
  for (const path of unclaimed) {
    diagnostics.push({
      line: 1,
      column: 1,
      code: 'unknown-document',
      file: path,
      message: `Nothing in this project declares "${path.replace(/^.*?(\.[^.]+\.xml)$/, '$1')}" documents.${blame(installed)}`,
    });
  }

  // What a package declared and its own types cannot support — an inline object type with no name
  // to call its element by. Reported against the project that installed it, because that is where
  // it stops a build, with the package named so it is clear whose to fix.
  for (const [kind, shape] of shapes) {
    if (!shape) continue;
    const owner = byKind.get(kind)?.package?.name;
    for (const problem of shapeProblems(shape)) {
      diagnostics.push({
        line: 1,
        column: 1,
        code: 'declaration',
        file: `package.json`,
        message: `"${owner ?? kind}" declares <${shape.name}>, which cannot be authored: ${problem}`,
      });
    }
  }

  // Mistakes in the components themselves, reported with the rest so one command answers
  // "is this project sound" whether the problem is in a document or in a class.
  for (const info of [...model.components, ...model.systems, ...model.effects]) {
    for (const problem of info.problems ?? []) {
      diagnostics.push({
        line: problem.line,
        column: 1,
        code: problem.code,
        message: problem.message,
        file: relative(root, info.file).split(sep).join('/'),
      });
    }
  }

  // Named up front, so a prefab can reference a geometry declared anywhere and a scene can
  // reference any prefab — the file order only decides what is *emitted* first.
  for (const asset of assets) exports.set(asset.path, exportOf(asset, byKind.get(asset.kind)));

  // Parsed before anything is emitted, because whether a document has to *wait* depends on what
  // the documents it spawns need, and that is not a question the file order can answer.
  const parsed = new Map<string, SncElement>();
  for (const asset of assets) {
    const result = parseDocument(readFileSync(asset.path, 'utf8'), asset.relativePath);
    if (result.ok) parsed.set(asset.path, result.root);
    else diagnostics.push(...result.diagnostics);
  }

  const fileFor = (from: string, href: string): FileImport | undefined => {
    // Not a document in this project. An image, a model or a sound is already a resource, so a
    // path straight at the file is the reference — provided the file is really there, which is
    // what turns a mistyped path into a build error instead of a 404 at runtime.
    const kind = fileKindOf(href, fileKinds);
    const target = resolve(dirname(from), href);
    if (!kind || !existsSync(target)) return undefined;
    return {
      kind: 'file',
      href,
      helper: kind.helper,
      await: kind.await,
      stem: basename(target).replace(/\.[^.]+$/, '') + kind.suffix,
    };
  };

  const waiting = documentsThatWait(assets, parsed, exports, fileFor);
  // What each prefab offers an `<Override>`. Computed before emission for the same reason the
  // parse is: a scene is emitted before or after the prefab it spawns depending on the file
  // names, and neither order may decide what a scene is allowed to override.
  const surfaces = new Map<string, PrefabSurface>();
  for (const asset of assets) {
    if (asset.kind !== 'prefab') continue;
    const document = parsed.get(asset.path);
    if (document) surfaces.set(asset.path, surfaceOf(document));
  }

  for (const asset of assets) {
    const root = parsed.get(asset.path);
    if (!root) continue;

    const resolveAsset: ResolveAsset = Object.assign(
      (href: string) => {
        const target = resolve(dirname(asset.path), href);
        const exported = exports.get(target);
        if (exported) {
          const surface = surfaces.get(target);
          return {
            ...exported,
            module: importSpecifier(asset.outputPath, target),
            ...(waiting.has(target) ? { waits: true } : {}),
            ...(surface ? { surface } : {}),
          };
        }
        return fileFor(asset.path, href);
      },
      { near: (href: string) => nearDocument(href, asset.path, exports.keys()) },
    );

    const emitted = emitOne(asset, byKind.get(asset.kind)!, root, {
      model,
      shapes,
      configs,
      plainPackages,
      resolveAsset,
      ...(options.provenance ? { provenance: true } : {}),
    });

    diagnostics.push(...emitted.diagnostics);
    if (emitted.code) files.set(asset.outputPath, rewriteComponentImports(emitted.code, asset.outputPath));
  }

  diagnostics.push(...emitPreviews(root, installed, model, files));

  files.set(resolve(root, MODEL_FILE), serializeModel({ ...model, ...describeModules(kinds, shapes, installed) }, root));

  if (!options.dryRun) {
    for (const [path, source] of files) {
      // Only when it changed: a watcher that rewrites an unchanged file restarts the dev
      // server's HMR graph for nothing.
      let existing: string | undefined;
      try {
        existing = readFileSync(path, 'utf8');
      } catch {
        existing = undefined;
      }
      if (existing === source) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
  }

  return { files, diagnostics, model, kinds, shapes };
}

/**
 * Why a document's kind might be unclaimed, said as precisely as what is known allows.
 *
 * A dependency that is declared but not installed is the overwhelmingly likely cause — a fresh
 * clone, a pruned install — and naming it turns a puzzle into one command.
 */
/**
 * The one document an `href` that resolves to nothing most likely meant, as the path to write
 * from `from`: the same file spelled from the project root (`assets/geometry/x` inside
 * `assets/prefabs/`), or without its `.asset.xml`. Undefined when no single document fits.
 */
function nearDocument(href: string, from: string, documents: Iterable<string>): string | undefined {
  const tail = href.replace(/^(\.\.?\/)+|^\/+/, '').split('/').join(sep);
  const bare = (path: string) => path.replace(/(\.[a-z]+)?\.xml$/, '');
  const found = [...documents].filter((path) => path.endsWith(sep + tail) || bare(path).endsWith(sep + tail));
  if (found.length !== 1) return undefined;
  const path = relative(dirname(from), found[0]!).split(sep).join('/');
  return path.startsWith('.') ? path : `./${path}`;
}

function blame(installed: ModuleManifests): string {
  if (installed.missing.length === 0) {
    return ' The package that declares this kind is either not installed or not a SceNoCo module.';
  }
  const names = installed.missing.map((name) => `"${name}"`).join(', ');
  const verb = installed.missing.length > 1 ? 'are dependencies' : 'is a dependency';
  return ` ${names} ${verb} of this project but not installed — run \`npm install\`.`;
}

/** Where a preview lands, so an editor has one place to fetch them from. */
const PREVIEW_DIR = '.scenoco/previews';

/**
 * Copy out every declared preview, and check it is one.
 *
 * A preview is the one piece of a project's own code an editor is allowed to run, so what it may
 * be is kept as small as it can be: **one file, already JavaScript, importing nothing but
 * `three`**. An editor is a page — it can fetch a module and import it, and it has no build. The
 * check here is what turns that from a convention into a rule, at the one moment someone is
 * looking at build output rather than at a blank viewport a week later.
 *
 * They are copied rather than pointed at because the reader may be a page that opened a folder: a
 * package's own file is outside the project entirely, and `node_modules` is not somewhere an
 * editor should be reaching into.
 */
function emitPreviews(
  root: string,
  installed: ModuleManifests,
  model: ProjectModel,
  files: Map<string, string>,
): SncDiagnostic[] {
  const declared = previewsOf([...installed.modules, ...(installed.project ? [installed.project] : [])]);
  if (declared.length === 0) return [];

  const diagnostics: SncDiagnostic[] = [];
  const components = new Map(model.components.map((info) => [info.name, info]));

  for (const { component, owner, path } of declared) {
    const where = relative(root, resolve(owner.dir, 'package.json')).split(sep).join('/');
    const complain = (message: string): void => {
      diagnostics.push({ line: 1, column: 1, code: 'preview', file: where, message });
    };

    const info = components.get(component);
    if (!info) {
      complain(`"${owner.name}" declares a preview for ${component}, which is not a component in this project.`);
      continue;
    }
    if (/\.m?tsx?$/.test(path)) {
      complain(
        `${component}'s preview is ${path}. A preview is loaded by an editor as it stands, and an ` +
          'editor has no TypeScript — write it as a `.js` module.',
      );
      continue;
    }

    let source: string;
    try {
      source = readFileSync(resolve(owner.dir, path), 'utf8');
    } catch {
      complain(`${component}'s preview names ${path}, which is not there.`);
      continue;
    }

    const foreign = importsOf(source).filter((specifier) => specifier !== 'three');
    if (foreign.length > 0) {
      complain(
        `${component}'s preview imports ${foreign.map((s) => `"${s}"`).join(', ')}. A preview is one ` +
          'file that takes the component\'s attributes and returns an Object3D; `three` is the only ' +
          'import an editor can resolve for it.',
      );
      continue;
    }

    const out = `${PREVIEW_DIR}/${component}.js`;
    files.set(resolve(root, out), withoutThreeImport(source));
    info.preview = out;
  }
  return diagnostics;
}

/**
 * Take the `three` import out of a preview, leaving a module that imports nothing at all.
 *
 * The source stays ordinary code — `import { Mesh } from 'three'` — because that is what the
 * project's own runtime imports. The *copy* must have no imports whatsoever, and the reason is
 * specific: whoever serves this file may not serve it verbatim. A dev server rewrites bare
 * specifiers to its own paths, so the artifact reaching a page had already stopped saying "three"
 * and started naming a file on another origin. A module with nothing to resolve cannot be rewritten
 * into something unresolvable, and can be imported from a blob — which a folder-opened project
 * leaves as the only option.
 */
function withoutThreeImport(source: string): string {
  return source.replace(
    /^[ \t]*import\s+([\s\S]*?)\s+from\s*(['"])three\2\s*;?[ \t]*$/gm,
    (_all, clause: string) => {
      const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause.trim());
      if (namespace) return `const ${namespace[1]} = globalThis.${PREVIEW_THREE};`;
      // `{ Mesh, BufferGeometry as Geometry }` → the same names, destructured.
      const named = clause.trim().replace(/\bas\b/g, ':');
      return `const ${named} = globalThis.${PREVIEW_THREE};`;
    },
  );
}

/** Every module specifier a source imports from, static and dynamic. */
function importsOf(source: string): string[] {
  const found: string[] = [];
  // Static `import`/`export … from '…'`, and `import('…')`. A preview is small and flat, so this
  // reads it rather than parsing it — and anything it cannot see is something it would refuse.
  for (const match of source.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1]!;
    // A type-only import is erased before this ever runs, but a `.js` file has none anyway.
    if (!found.includes(specifier)) found.push(specifier);
  }
  return found;
}

/**
 * What this project's packages brought with them, for a reader with no checker.
 *
 * The editor is the reader: it has no TypeScript, so a document kind is only usable there if its
 * whole vocabulary — every element, every attribute, every type — arrives as data.
 */
function describeModules(
  kinds: readonly AssetKind[],
  shapes: ReadonlyMap<string, ConfigShape | undefined>,
  installed: ModuleManifests,
): Pick<ProjectModel, 'documents' | 'modules'> {
  const documents = kinds
    .filter((kind) => kind.type && kind.package)
    .map((kind) => {
      const shape = shapes.get(kind.kind);
      return {
        kind: kind.kind,
        extension: kind.extension,
        dir: kind.dir,
        description: kind.description,
        module: kind.package!.name,
        ...(shape ? { shape: portableShape(shape) } : {}),
      };
    });
  const modules = installed.modules.map((module) => ({
    name: module.name,
    ...(module.version ? { version: module.version } : {}),
  }));
  return { documents, modules };
}

/** A config shape as JSON: the same tree, with its maps as objects. */
function portableShape(shape: ConfigShape): DocumentShape {
  const asObject = (entries: ReadonlyMap<string, ConfigShape>): Record<string, DocumentShape> =>
    Object.fromEntries([...entries].map(([field, inner]) => [field, portableShape(inner)]));
  return {
    name: shape.name,
    ...(shape.description ? { description: shape.description } : {}),
    fields: shape.fields,
    groups: asObject(shape.groups),
    lists: asObject(shape.lists),
  };
}

/**
 * The model as a file, for a reader with no checker of its own.
 *
 * A class's `file` is written relative to the root: the absolute path says where it was on the
 * machine that built it, which means nothing to a browser and is nobody else's business.
 */
function serializeModel(model: ProjectModel, root: string): string {
  const portable = <T extends { file: string }>(info: T): T => ({
    ...info,
    file: relative(root, info.file).split(sep).join('/'),
  });
  return JSON.stringify({
    components: model.components.map(portable),
    systems: model.systems.map(portable),
    effects: model.effects.map(portable),
    tags: model.tags,
    ...(model.documents ? { documents: model.documents } : {}),
    ...(model.modules ? { modules: model.modules } : {}),
  } satisfies ProjectModel);
}

/**
 * Which documents cannot be built until a file has arrived.
 *
 * A document waits if it names a model or a sound itself, **or** if it spawns a prefab that
 * does — a prefab has nowhere to await, so the waiting lands on whoever spawns it, and that
 * propagates up however many levels the document graph has.
 *
 * Computed to a fixpoint rather than in emission order, because prefab A may spawn prefab B
 * whichever way the two sort. Getting this wrong in the cheap direction would mean a scene that
 * builds a model before its bytes are there — which the runtime catches, but only at the point
 * where nothing explains why.
 */
function documentsThatWait(
  assets: readonly AssetFile[],
  parsed: ReadonlyMap<string, SncElement>,
  exports: ReadonlyMap<string, AssetImport>,
  fileFor: (from: string, href: string) => FileImport | undefined,
): Set<string> {
  const waits = new Set<string>();
  /** absolute path → the prefab documents it spawns. */
  const spawns = new Map<string, string[]>();

  for (const asset of assets) {
    const root = parsed.get(asset.path);
    if (!root) continue;
    const spawned: string[] = [];
    let direct = false;

    walk(root, (element) => {
      for (const [attribute, text] of element.attributes) {
        const target = resolve(dirname(asset.path), text);
        // A `<Prefab src>` naming another document is a dependency; naming a model is a wait.
        if (attribute === 'src' && exports.get(target)?.kind === 'prefab') {
          spawned.push(target);
          continue;
        }
        // Any attribute may hold a path — `map`, `clip`, `src`. A value that is not one simply
        // resolves to nothing, so this needs no list of which attributes are asset references.
        if (fileFor(asset.path, text)?.await) direct = true;
      }
    });

    spawns.set(asset.path, spawned);
    if (direct) waits.add(asset.path);
  }

  for (let changed = true; changed; ) {
    changed = false;
    for (const [path, spawned] of spawns) {
      if (waits.has(path)) continue;
      if (spawned.some((target) => waits.has(target))) {
        waits.add(path);
        changed = true;
      }
    }
  }
  return waits;
}

/**
 * Index one prefab document's ids — the only thing a spawning document may reach into.
 *
 * A node id and a component id are both recorded, because both are fields on the generated
 * prefab class and an override of either is one assignment. What is *not* recorded is anything
 * without an id: a prefab that wants a value adjustable names the thing that holds it, and the
 * diagnostic for a missing target says so.
 */
function surfaceOf(root: SncElement): PrefabSurface {
  const ids = new Map<string, PrefabTarget>();

  const visit = (element: SncElement, isRoot: boolean): void => {
    if (element.tag === 'Systems') return;
    if (element.tag === 'Components') {
      for (const component of element.children) {
        const id = component.attributes.get('id');
        if (id) ids.set(id, { tag: component.tag, kind: 'component' });
      }
      return;
    }
    const id = element.attributes.get('id');
    if (id) {
      ids.set(id, {
        tag: element.tag,
        kind: element.tag === 'Prefab' ? 'prefab' : 'node',
        ...(isRoot ? { root: true } : {}),
      });
    }
    for (const child of element.children) visit(child, false);
  };

  visit(root, true);
  return { ids };
}

function walk(element: SncElement, visit: (element: SncElement) => void): void {
  visit(element);
  for (const child of element.children) walk(child, visit);
}

/** Dispatch one document to the emitter for its kind. */
function emitOne(
  asset: AssetFile,
  kind: AssetKind,
  root: SncElement,
  context: {
    model: ProjectModel;
    shapes: ReadonlyMap<string, ConfigShape | undefined>;
    /** The config types by their own name, for a document that writes one inside an element. */
    configs: ReadonlyMap<string, ConfigType>;
    /** Installed packages this build reads nothing from — see `EmitScope.moduleHint`. */
    plainPackages: readonly string[];
    resolveAsset: ResolveAsset;
    provenance?: boolean;
  },
): { code?: string; diagnostics: SncDiagnostic[] } {
  const { model, resolveAsset } = context;

  if (asset.kind === 'texture') {
    return emitTexture(root, { name: asset.stem, model, source: asset.relativePath });
  }

  if (asset.kind === 'asset') {
    return emitResource(root, {
      name: asset.stem,
      model,
      source: asset.relativePath,
      // A material's `map` reaches a texture document or an image file; a geometry has nothing
      // to reference, and passing the resolver anyway costs nothing and keeps one call shape.
      resolveAsset,
    });
  }

  if (asset.kind === 'render') {
    return emitRender(root, {
      name: asset.stem,
      model,
      source: asset.relativePath,
      // An effect may name an asset — a texture for a LUT, a shader — the same way anything
      // else does.
      resolveAsset,
    });
  }

  // Every kind a package declares: one typed value, built from one element tree.
  if (kind.type) {
    const shape = context.shapes.get(kind.kind);
    if (!shape) {
      return {
        diagnostics: [
          {
            line: root.line,
            column: root.column,
            code: 'missing-package',
            message:
              `A ${kind.extension} needs ${kind.type} from "${moduleOf(kind)}", which this project ` +
              'does not resolve. Add the package as a dependency, and import it somewhere.',
            file: asset.relativePath,
          },
        ],
      };
    }
    return emitConfigDocument(root, {
      name: asset.stem,
      source: asset.relativePath,
      shape,
      module: moduleOf(kind),
      resolveAsset,
    });
  }

  if (asset.kind !== 'scene' && asset.kind !== 'prefab') {
    throw new Error(`[scenoco] internal: no emitter for the document kind "${asset.kind}".`);
  }

  return emitGraph(root, {
    ...(context.provenance ? { provenance: true } : {}),
    kind: asset.kind,
    name: exportedName(asset),
    source: asset.relativePath,
    model,
    configs: context.configs,
    plainPackages: context.plainPackages,
    resolveAsset,
  });
}

/** Where a declared kind's type is imported from — the package that declared the kind. */
function moduleOf(kind: AssetKind): string {
  return kind.package?.name ?? '';
}

/** What one document exports, and under what name. */
function exportOf(asset: AssetFile, kind: AssetKind | undefined): AssetImport {
  // A texture, a geometry, a material, a particle effect — each is one shared value. A prefab or
  // a scene exports a class, because those two build something each time they are used.
  const type = asset.kind === 'scene' ? 'SceneType' : asset.kind === 'prefab' ? 'PrefabType' : kind?.type;
  return {
    module: asset.outputPath,
    name: exportedName(asset),
    kind: asset.kind === 'scene' ? 'scene' : asset.kind === 'prefab' ? 'prefab' : 'value',
    ...(type ? { type } : {}),
  };
}

/**
 * The name a document's generated module exports.
 *
 * A prefab and a scene are **suffixed** — `brick.prefab.xml` is `BrickPrefab`, `level-1.scene.xml`
 * is `Level1Scene`. Two reasons, and the second is the one that bites:
 *
 *  - It says what the name *is* at every use. `instantiate(BrickPrefab)` and
 *    `SceneManager.load(Level1Scene)` read as what they do; `instantiate(Brick)` could be
 *    anything.
 *  - Without it, a document collides with a component of the same name — and a `hud.prefab.xml`
 *    beside a `Hud` component is the natural way to name a matched pair. That collision was
 *    invisible on a clean checkout and appeared on the *second* build, once the generated file
 *    existed for the scan to find, which is the worst possible failure shape.
 *
 * A name that already ends in the suffix is left alone, so `brick-prefab.prefab.xml` does not
 * become `BrickPrefabPrefab`.
 */
export function exportedName(asset: AssetFile): string {
  const pascal = pascalCase(asset.stem);
  if (asset.kind === 'prefab') return pascal.endsWith('Prefab') ? pascal : `${pascal}Prefab`;
  if (asset.kind === 'scene') return pascal.endsWith('Scene') ? pascal : `${pascal}Scene`;
  return camelCase(asset.stem);
}

/**
 * A module specifier from one generated file to another, as TypeScript wants it written:
 * relative, `./`-prefixed, and with the `.js` extension the emitted ESM will actually resolve.
 */
function importSpecifier(fromFile: string, toXml: string): string {
  const toFile = `${toXml.replace(/\.xml$/, '')}.gen.js`;
  const path = relative(dirname(fromFile), toFile).split(sep).join('/');
  return path.startsWith('.') ? path : `./${path}`;
}

/**
 * The graph emitter names a component by the absolute path of the file declaring it, because
 * that is what the scan knows. Only the driver knows where the generated file lands, so this
 * is where those become relative specifiers.
 */
function rewriteComponentImports(code: string, outputPath: string): string {
  return code.replace(/ from '(\/[^']+\.ts)';/g, (_match, absolute: string) => {
    const target = absolute.replace(/\.ts$/, '.js');
    const path = relative(dirname(outputPath), target).split(sep).join('/');
    return ` from '${path.startsWith('.') ? path : `./${path}`}';`;
  });
}

/** `tsc`-style rendering of everything a build reported. */
export function formatDiagnostics(diagnostics: readonly SncDiagnostic[]): string {
  return diagnostics.map((d) => formatDiagnostic(d)).join('\n');
}
