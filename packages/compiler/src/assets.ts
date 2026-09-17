import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The kinds the compiler itself has an emitter for. */
export type BuiltinKind = 'scene' | 'prefab' | 'asset' | 'texture' | 'render';

/** What kinds of document a SceNoCo project holds, and what each compiles to. */
export interface AssetKind {
  /** The `scenoco new <kind>` name. A builtin's, or one a package declared. */
  kind: string;
  /** File suffix. */
  extension: string;
  /** One-line summary — what `scenoco new` prints. */
  description: string;
  /** Project-relative directory new files of this kind go in. */
  dir: string;
  /** Absent for a builtin; the package that declared this kind otherwise. */
  package?: { name: string; dir: string };
  /**
   * Package-declared kinds only: the exported type whose declaration *is* the document's shape.
   * Its name is the root tag; its fields are the attributes and the nested elements.
   */
  type?: string;
  /** Package-declared kinds only: the starter document, relative to `package.dir`. */
  template?: string;
}

/**
 * The document kinds the compiler ships with, in the order a project reads them.
 *
 * No kind per three.js class: a material and a geometry construct from attributes, so one
 * `.asset.xml` holds either and its root tag says which. What is here is what three.js has no
 * constructor for — a texture's data comes from an image file, and the rest are ours.
 *
 * A package adds to this list by declaring a kind in its own `package.json`; see
 * {@link ModuleManifest}. Everything a package declares is a *config document* — one typed value,
 * built from one element tree — because an emitter is code and a manifest is not.
 */
export const BUILTIN_KINDS: readonly AssetKind[] = [
  {
    kind: 'texture',
    extension: '.texture.xml',
    description: 'A configured texture: an image plus its sampler settings',
    dir: 'assets/textures',
  },
  {
    kind: 'asset',
    extension: '.asset.xml',
    description: 'A shared three.js object — a material, a geometry — named by its root tag',
    dir: 'assets',
  },
  {
    kind: 'render',
    extension: '.render.xml',
    description: 'How a scene is drawn: tone mapping, shadows, post effects',
    dir: 'assets/render',
  },
  {
    kind: 'prefab',
    extension: '.prefab.xml',
    description: 'A reusable node, spawned with <Prefab src="…"> or instantiate()',
    // Where `scenoco init` puts the one it ships, and where every example keeps theirs. This said
    // `assets/scenes`, so `scenoco new prefab gem` wrote a prefab into the scenes folder and left
    // the project's own convention to be repaired by hand.
    dir: 'assets/prefabs',
  },
  {
    kind: 'scene',
    extension: '.scene.xml',
    description: 'A scene: the <Scene> root with its nodes and components',
    dir: 'assets/scenes',
  },
];

/**
 * A kind of file that is a resource on its own, with no document wrapped around it.
 *
 * An image, a glTF and a sound are already assets — they have a path, they are edited in another
 * tool, and there is nothing to author about them. So `map="brick.png"` is allowed to name the
 * file itself, and a `.texture.xml` exists only for the case where the sampler settings matter.
 * The two are not two spellings of one value: one is "this image with defaults", the other is
 * "this configured texture", the same relationship `<Mesh>` and `<Prefab src>` already have.
 *
 * Each entry says which runtime helper turns a URL into the shared value, and whether the value
 * has to exist before the scene builds.
 */
export interface FileKind {
  /** Lowercased, no dot. */
  extensions: readonly string[];
  /** The helper that produces the shared runtime value for a URL. */
  helper: { module: string; name: string };
  /**
   * Appended to the file's name for the generated const: `brick.png` → `brickTexture`.
   *
   * It says what the value is at every use — and it keeps `brick.png` and `brick.asset.xml`,
   * which is how anyone would name a matching pair, from colliding into `brick` and `brick$2`.
   */
  suffix: string;
  /**
   * True when the bytes must be there before anything uses the value, which is what puts it in
   * a scene's `loadAssets(…)`. A texture is false: three.js hands one over before its image
   * lands, so a material can be built with it at module scope.
   */
  await: boolean;
}

/**
 * What the compiler loads on its own: the two whose helper is core's. A sound is not here — the
 * package that can play one is the package that says how it loads.
 */
export const BUILTIN_FILE_KINDS: readonly FileKind[] = [
  {
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'gif'],
    helper: { module: '@scenoco-three/core', name: 'sharedTexture' },
    suffix: 'Texture',
    await: false,
  },
  {
    extensions: ['glb', 'gltf'],
    helper: { module: '@scenoco-three/core', name: 'sharedModel' },
    suffix: 'Model',
    await: true,
  },
];

/** The file kind for a path, or undefined when nothing here loads it. */
export function fileKindOf(path: string, kinds: readonly FileKind[] = BUILTIN_FILE_KINDS): FileKind | undefined {
  const clean = path.split(/[?#]/)[0] ?? path;
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return undefined;
  const extension = clean.slice(dot + 1).toLowerCase();
  return kinds.find((kind) => kind.extensions.includes(extension));
}

/** One document found in a project. */
export interface AssetFile {
  kind: AssetKind['kind'];
  /** Absolute path of the XML. */
  path: string;
  /** Path relative to the project root, for banners and diagnostics. */
  relativePath: string;
  /** File name without the kind suffix — `brick` from `brick.prefab.xml`. */
  stem: string;
  /** Absolute path of the TypeScript this compiles to. */
  outputPath: string;
}

/** The generated file for a document sits beside it, so an import path reads like the XML tree. */
export function outputPathFor(xmlPath: string): string {
  return `${xmlPath.replace(/\.xml$/, '')}.gen.ts`;
}

/** What a walk of a project found. */
export interface FoundAssets {
  /** The documents, in the order they are emitted. */
  documents: AssetFile[];
  /**
   * Files that look like a document of a kind nothing declared — `fire.particle.xml` in a project
   * whose VFX package is not installed.
   *
   * Walking past those silently is the one failure worse than not compiling at all: no output, no
   * message, and the breakage lands wherever the missing module was named. The walk has no
   * diagnostics channel, so it hands them back and the driver reports them.
   */
  unclaimed: string[];
}

/**
 * Every document under `root`, in the order they are emitted: resources first, then prefabs,
 * then scenes.
 *
 * Only the order of *messages* rides on this now — every document's export is registered before
 * anything is parsed, so a prefab may reference a geometry declared anywhere and a scene may
 * spawn any prefab whichever way the two sort.
 */
export function findAssets(root: string, kinds: readonly AssetKind[] = BUILTIN_KINDS): FoundAssets {
  const found: FoundAssets = { documents: [], unclaimed: [] };
  // Longest suffix first: `.asset.xml` and a package's `.fx.asset.xml` both end a file's name, and
  // which one claims it must not depend on the order packages were installed in.
  const matching = [...kinds].sort((a, b) => b.extension.length - a.extension.length);
  walk(root, root, matching, found);
  const rank = new Map(orderedKinds(kinds).map((kind, index) => [kind.kind, index]));
  found.documents.sort(
    (a, b) => rank.get(a.kind)! - rank.get(b.kind)! || a.relativePath.localeCompare(b.relativePath),
  );
  return found;
}

/** Resources, then whatever packages declared, then prefabs, then scenes. */
function orderedKinds(kinds: readonly AssetKind[]): readonly AssetKind[] {
  const tier = (kind: AssetKind): number =>
    kind.kind === 'scene' ? 3 : kind.kind === 'prefab' ? 2 : kind.package ? 1 : 0;
  return [...kinds].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      (tier(a) === 0
        ? BUILTIN_KINDS.findIndex((k) => k.kind === a.kind) - BUILTIN_KINDS.findIndex((k) => k.kind === b.kind)
        : a.kind.localeCompare(b.kind)),
  );
}

/** A file named like a document — `something.<word>.xml` — whoever turns out to own it. */
const DOCUMENT_SHAPED = /\.[A-Za-z][A-Za-z0-9-]*\.xml$/;

function walk(dir: string, root: string, kinds: readonly AssetKind[], out: FoundAssets): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, root, kinds, out);
      continue;
    }
    const kind = kinds.find((k) => entry.endsWith(k.extension));
    if (!kind) {
      if (DOCUMENT_SHAPED.test(entry)) out.unclaimed.push(relative(root, path).split(sep).join('/'));
      continue;
    }
    out.documents.push({
      kind: kind.kind,
      path,
      relativePath: relative(root, path).split(sep).join('/'),
      stem: entry.slice(0, -kind.extension.length),
      outputPath: outputPathFor(path),
    });
  }
}
