import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** What kinds of document a SceNoCo project holds, and what each compiles to. */
export interface AssetKind {
  /** The `scenoco new <kind>` name. */
  kind: 'scene' | 'prefab' | 'geometry' | 'material' | 'particle' | 'texture' | 'render';
  /** File suffix. */
  extension: string;
  /** One-line summary — what `scenoco new` prints. */
  description: string;
  /** Project-relative directory new files of this kind go in. */
  dir: string;
  /**
   * The type a document of this kind produces, for a field that wants to *reference* one.
   *
   * A mesh's `geometry` is declared `BufferGeometry`, so `geometry="brick.geometry.xml"` is
   * how you fill it; a particle emitter's `effect` is declared `ParticleConfig`, so the same
   * spelling reaches a `.particle.xml`. That correspondence is what makes an asset reference
   * one rule rather than three special cases, so it is declared here beside the kind.
   *
   * A prefab and a scene both compile to a *class*, and both are named the same way: a field
   * declared `PrefabType` is filled by `brick.prefab.xml` and spawned with `instantiate`, a
   * field declared `SceneType` by `level-2.scene.xml` and loaded with `SceneManager.load`.
   * That is how a component lays out the repetitive half of a level — a grid of bricks is a
   * loop over one prefab reference, not sixty near-identical elements.
   */
  type?: string;
}

/**
 * The document kinds, in the order a project reads them.
 *
 * Geometry and material are here because `<Attachments>` is gone. A mesh's geometry was a
 * sub-element that existed only inside whatever node declared it; it is now an asset with a
 * path, referenced by however many meshes want it — which is what Unity's mesh/`.mat` split
 * and Cocos's mesh/material references have always been.
 */
export const ASSET_KINDS: readonly AssetKind[] = [
  {
    kind: 'texture',
    type: 'Texture',
    extension: '.texture.xml',
    description: 'A configured texture: an image plus its sampler settings',
    dir: 'assets/textures',
  },
  {
    kind: 'geometry',
    type: 'BufferGeometry',
    extension: '.geometry.xml',
    description: 'A shared geometry: one three.js geometry element, referenced by meshes',
    dir: 'assets/geometry',
  },
  {
    kind: 'material',
    type: 'Material',
    extension: '.material.xml',
    description: 'A shared material: one three.js material element, referenced by meshes',
    dir: 'assets/materials',
  },
  {
    kind: 'particle',
    type: 'ParticleConfig',
    extension: '.particle.xml',
    description: 'A particle effect, in Unity Shuriken module form',
    dir: 'assets/vfx',
  },
  {
    kind: 'render',
    type: 'RenderSettings',
    extension: '.render.xml',
    description: 'How a scene is drawn: tone mapping, shadows, post effects',
    dir: 'assets/render',
  },
  {
    kind: 'prefab',
    type: 'PrefabType',
    extension: '.prefab.xml',
    description: 'A reusable node, spawned with <Prefab src="…"> or instantiate()',
    dir: 'assets/scenes',
  },
  {
    kind: 'scene',
    type: 'SceneType',
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
   * It says what the value is at every use — and it keeps `brick.png` and `brick.material.xml`,
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

export const FILE_KINDS: readonly FileKind[] = [
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
  {
    extensions: ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac'],
    helper: { module: '@scenoco-three/audio', name: 'sharedClip' },
    suffix: 'Clip',
    await: true,
  },
];

/** The file kind for a path, or undefined when nothing here loads it. */
export function fileKindOf(path: string): FileKind | undefined {
  const clean = path.split(/[?#]/)[0] ?? path;
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return undefined;
  const extension = clean.slice(dot + 1).toLowerCase();
  return FILE_KINDS.find((kind) => kind.extensions.includes(extension));
}

/**
 * The declared types that mean "a reference to a document in this project".
 *
 * Derived from the kinds above rather than restated, so a new asset kind is one entry. `Model`
 * and `AudioClip` are named here too: both are referenced exactly like a document is, and both
 * come from a raw file rather than a document of their own.
 */
export const ASSET_TYPES: ReadonlySet<string> = new Set([
  ...ASSET_KINDS.map((k) => k.type).filter((t): t is string => t !== undefined),
  'Model',
  'AudioClip',
]);

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

/**
 * Every document under `root`, in dependency order: geometry and material first, then prefabs,
 * then scenes.
 *
 * The order matters because a scene imports the prefabs it spawns and a prefab imports the
 * geometry it uses, and the driver resolves each document's references against what it has
 * already seen. A cycle between two prefabs is therefore reported rather than emitted.
 */
export function findAssets(root: string): AssetFile[] {
  const found: AssetFile[] = [];
  walk(root, root, found);
  const order = new Map(ASSET_KINDS.map((k, index) => [k.kind, index]));
  return found.sort(
    (a, b) => order.get(a.kind)! - order.get(b.kind)! || a.relativePath.localeCompare(b.relativePath),
  );
}

function walk(dir: string, root: string, out: AssetFile[]): void {
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
      walk(path, root, out);
      continue;
    }
    const kind = ASSET_KINDS.find((k) => entry.endsWith(k.extension));
    if (!kind) continue;
    out.push({
      kind: kind.kind,
      path,
      relativePath: relative(root, path).split(sep).join('/'),
      stem: entry.slice(0, -kind.extension.length),
      outputPath: outputPathFor(path),
    });
  }
}

/** `@scenoco-three/*` packages that are toolchain or runtime, and declare no tags. */
const NOT_TAG_PACKAGES = new Set([
  '@scenoco-three/core',
  '@scenoco-three/compiler',
  '@scenoco-three/vite',
  '@scenoco-three/editor',
]);

/**
 * The tag packages a project depends on, read from its `package.json`.
 *
 * A document's vocabulary is `three` plus whatever packages the project brings in, and a project
 * already declares those — in its dependencies. Making every caller repeat the list as
 * `--modules` is asking the same question twice and getting two answers: the editor refusing to
 * open a project its own `vite.config.ts` compiles happily is what that looks like in practice.
 *
 * The toolchain packages are excluded because they export no tags; everything else under the
 * scope qualifies, so a new tag package works the moment it is installed.
 */
export function detectTagPackages(root: string): string[] {
  const manifest = resolve(root, 'package.json');
  if (!existsSync(manifest)) return [];
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8')) as typeof pkg;
  } catch {
    return []; // an unreadable manifest is not a reason to refuse to compile
  }
  const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  return [...names].filter((n) => n.startsWith('@scenoco-three/') && !NOT_TAG_PACKAGES.has(n)).sort();
}
