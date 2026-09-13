import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** What kinds of document a SceNoCo project holds, and what each compiles to. */
export interface AssetKind {
  /** The `scenoco new <kind>` name. */
  kind: 'scene' | 'prefab' | 'asset' | 'particle' | 'texture' | 'render';
  /** File suffix. */
  extension: string;
  /** One-line summary — what `scenoco new` prints. */
  description: string;
  /** Project-relative directory new files of this kind go in. */
  dir: string;
}

/**
 * The document kinds, in the order a project reads them.
 *
 * No kind per three.js class: a material and a geometry construct from attributes, so one
 * `.asset.xml` holds either and its root tag says which. What is here is what three.js has no
 * constructor for — a texture's data comes from an image file, and the rest are ours.
 */
export const ASSET_KINDS: readonly AssetKind[] = [
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
    kind: 'particle',
    extension: '.particle.xml',
    description: 'A particle effect, in Unity Shuriken module form',
    dir: 'assets/vfx',
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
  '@scenoco-three/observer',
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
