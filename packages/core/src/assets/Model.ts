import type { AnimationClip, Object3D } from 'three';
import { Asset } from './Asset.js';
import { shared } from './shared.js';

/** What the glTF loader hands back. Structural, so nothing here imports the addon's types. */
interface LoadedGltf {
  scene: Object3D;
  animations?: AnimationClip[];
}

/**
 * A glTF/GLB model — a prefab that came from a file, and something `instantiate` takes.
 *
 * No wrapper node: the model's own root is the node you get. Each instance is a `SkeletonUtils`
 * clone, so skinned meshes rebind to their own skeleton while geometry, materials and textures
 * stay shared.
 */
export class Model extends Asset<LoadedGltf> {
  /** The animation clips the file ships with, for an `AnimationMixer` to play. Empty until loaded. */
  get clips(): readonly AnimationClip[] {
    return this.isLoaded ? (this.value.animations ?? []) : [];
  }

  /** A fresh copy of the model's root. `instantiate` calls this; call it for an unparented node. */
  instantiate(): Object3D {
    if (!cloneSkinned) {
      throw new Error(
        `[scenoco] Model "${this.url}" was cloned before its loader finished. ` +
          'Await it first: `await loadAssets(theModel)`.',
      );
    }
    const copy = cloneSkinned(this.value.scene);
    // three.js's own field for this, so an `Animator` on the instance finds its clips without
    // a reference to the asset.
    if (this.clips.length > 0) copy.animations = [...this.clips];
    return copy;
  }

  protected override async fetch(): Promise<LoadedGltf> {
    // Imported here so a project with no model ships neither addon — both are large.
    const [{ GLTFLoader }, skeletonUtils] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/utils/SkeletonUtils.js'),
    ]);
    cloneSkinned ??= skeletonUtils.clone;
    const gltf = (await new GLTFLoader().loadAsync(this.url)) as LoadedGltf;
    // Everything inside the file is shared by every instance, so scene unload must leave it be.
    markSubtreeShared(gltf.scene);
    return gltf;
  }

  protected override free(value: LoadedGltf): void {
    value.scene.traverse((object) => {
      const mesh = object as Object3D & { geometry?: { dispose?(): void }; material?: unknown };
      mesh.geometry?.dispose?.();
      for (const material of materialsOf(mesh.material)) material.dispose?.();
    });
  }
}

/** The model for a URL — one per URL, shared by everything that asks. */
export function sharedModel(url: string): Model {
  let model = cache.get(url);
  if (!model) {
    model = shared(new Model(url));
    cache.set(url, model);
  }
  return model;
}

let cloneSkinned: ((source: Object3D) => Object3D) | undefined;

/**
 * @internal a deep copy of a node tree. A skinned mesh only comes from a model, so once a model
 * has loaded the skeleton-aware clone is at hand and rebinds it; before that, three's own does.
 */
export function cloneTree(source: Object3D): Object3D {
  return cloneSkinned ? cloneSkinned(source) : source.clone(true);
}
const cache = new Map<string, Model>();

/** @internal drop the URL cache. For tests and HMR; `disposeAssets` frees the models. */
export function clearModelCache(): void {
  cache.clear();
}

function markSubtreeShared(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Object3D & { geometry?: unknown; material?: unknown };
    if (mesh.geometry) shared(mesh.geometry);
    for (const material of materialsOf(mesh.material)) {
      shared(material);
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && 'isTexture' in value) shared(value);
      }
    }
  });
}

function materialsOf(material: unknown): Array<Record<string, unknown> & { dispose?(): void }> {
  if (!material) return [];
  const list = Array.isArray(material) ? material : [material];
  return list as Array<Record<string, unknown> & { dispose?(): void }>;
}
