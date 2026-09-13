import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { detectTagPackages, fileKindOf, findAssets, type AssetFile } from './assets.js';
import { formatDiagnostic, type SncDiagnostic } from './dsl/diagnostics.js';
import { parseDocument, type SncElement } from './dsl/parse.js';
import { emitConfigDocument } from './emit/config.js';
import { emitGraph } from './emit/graph.js';
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
import type { ProjectModel } from './model.js';
import { scanConfigShape, type ConfigShape } from './scan/interfaces.js';
import { Workspace } from './scan/workspace.js';
import { scanComponents, scanEffects, scanSystems } from './scan/components.js';
import { scanTags } from './scan/tags.js';
import { classSources, scanProject } from './scan/project.js';
import { PARTICLE_CONFIG, PARTICLE_MODULES } from './particles.js';

export interface BuildOptions {
  /** Project root — the directory holding `tsconfig.json` and `assets/`. */
  root: string;
  /** Defaults to `<root>/tsconfig.json`. */
  tsconfig?: string;
  /**
   * Modules whose tags the DSL accepts. Defaults to `three` plus the project's own
   * `@scenoco-three/*` dependencies — pass a list only to compile against something narrower or
   * wider than what the project declares.
   */
  modules?: readonly string[];
  /** Report what would be written without touching the disk. */
  dryRun?: boolean;
  /** Reuse an already-scanned model — the watcher does, so it scans once per change. */
  model?: ProjectModel;
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
  // A project that depends on a tag package means to use it; asking for the list again on the
  // command line only creates a way for the two to disagree.
  const modules = options.modules ?? ['three', ...detectTagPackages(root)];
  const assets = findAssets(root);
  // The particle config's shape is read from whichever package declares it, and only when a
  // project actually holds a `.particle.xml` — a project without one must not pay for the
  // lookup, and must not fail because the package is absent.
  const needsParticles = assets.some((a) => a.kind === 'particle');

  let model = options.model;
  let particleShape: ConfigShape | undefined;
  if (!model || needsParticles) {
    Workspace.with(
      tsconfig,
      (workspace) => {
        const packages = classSources(modules);
        model ??= {
          components: scanComponents(workspace, packages),
          systems: scanSystems(workspace, packages),
          effects: scanEffects(workspace, packages),
          tags: scanTags(workspace, modules),
        };
        if (needsParticles) {
          particleShape = scanConfigShape(workspace, PARTICLE_CONFIG.module, PARTICLE_CONFIG.name);
        }
      },
      root,
    );
  }
  model ??= scanProject(tsconfig, { cwd: root, modules });

  const exports = new Map<string, AssetImport>(); // absolute xml path → what it exports
  const files = new Map<string, string>();
  const diagnostics: SncDiagnostic[] = [];

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
  for (const asset of assets) exports.set(asset.path, exportOf(asset));

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
    const kind = fileKindOf(href);
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

    const resolveAsset: ResolveAsset = (href) => {
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
    };

    const emitted = emitOne(asset, root, {
      model,
      particleShape,
      resolveAsset,
      ...(options.provenance ? { provenance: true } : {}),
    });

    diagnostics.push(...emitted.diagnostics);
    if (emitted.code) files.set(asset.outputPath, rewriteComponentImports(emitted.code, asset.outputPath));
  }

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
      if (existing !== source) writeFileSync(path, source);
    }
  }

  return { files, diagnostics, model };
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
  root: SncElement,
  context: {
    model: ProjectModel;
    particleShape: ConfigShape | undefined;
    resolveAsset: ResolveAsset;
    provenance?: boolean;
  },
): { code?: string; diagnostics: SncDiagnostic[] } {
  const { model, particleShape, resolveAsset } = context;

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

  if (asset.kind === 'particle') {
    if (!particleShape) {
      return {
        diagnostics: [
          {
            line: root.line,
            column: root.column,
            code: 'missing-package',
            message:
              `A .particle.xml needs ${PARTICLE_CONFIG.name} from "${PARTICLE_CONFIG.module}", ` +
              'which this project does not resolve. Add the package as a dependency.',
            file: asset.relativePath,
          },
        ],
      };
    }
    return emitConfigDocument(root, {
      name: asset.stem,
      source: asset.relativePath,
      shape: particleShape,
      type: { module: PARTICLE_CONFIG.module, name: PARTICLE_CONFIG.name },
      rootTag: PARTICLE_CONFIG.rootTag,
      bindings: PARTICLE_MODULES,
      resolveAsset,
    });
  }

  return emitGraph(root, {
    ...(context.provenance ? { provenance: true } : {}),
    kind: asset.kind,
    name: exportedName(asset),
    source: asset.relativePath,
    model,
    resolveAsset,
  });
}

/** What one document exports, and under what name. */
function exportOf(asset: AssetFile): AssetImport {
  // A texture, geometry, material or particle document exports a value; a prefab or a scene
  // exports a class, because those two build something each time rather than being one shared
  // thing.
  const values = ['texture', 'asset', 'particle', 'render'] as const;
  const value = values.find((kind) => kind === asset.kind);
  return {
    module: asset.outputPath,
    name: exportedName(asset),
    kind: value ?? (asset.kind === 'scene' ? 'scene' : 'prefab'),
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
