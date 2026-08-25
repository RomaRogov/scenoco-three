import type { AnimationClip, Object3D } from 'three';
import { Asset } from './Asset.js';
import { shared } from './shared.js';

/** What the glTF loader hands back. Structural, so nothing here imports the addon's types. */
interface LoadedGltf {
  scene: Object3D;
  animations?: AnimationClip[];
}

/**
 * A glTF/GLB model — **a prefab that came from a file**.
 *
 * That is the whole idea, and it is Unity's: dropping an `.fbx` into a Unity project gives you a
 * prefab you `Instantiate()`. Here the same file gives you something `instantiate` takes:
 *
 * ```xml
 * <Prefab src="../models/hero.glb" position="y: 1" id="hero" />
 * ```
 *
 * ```ts
 * const enemy = this.instantiate(enemyModel, { position: spawn });
 * ```
 *
 * No wrapper node — the model's own root is the node you get, the same rule a `.prefab.xml`
 * follows. Each instance is a `SkeletonUtils` clone, so skinned meshes rebind to their own
 * skeleton while geometry, materials and textures stay shared with every other instance.
 *
 * The bytes have to arrive first, so a scene that references a model awaits it in `onLoad`
 * before building anything — which the compiler writes for you.
 */
export class Model extends Asset<LoadedGltf> {
  /** The animation clips the file ships with, for an `AnimationMixer` to play. Empty until loaded. */
  get clips(): readonly AnimationClip[] {
    return this.isLoaded ? (this.value.animations ?? []) : [];
  }

  /**
   * A fresh copy of the model's root, ready to add to the scene.
   *
   * `Object3D.instantiate` calls this, so a model and a `.prefab.xml` spawn through the same
   * verb; call it directly only when you want the node without parenting it anywhere.
   */
  instantiate(): Object3D {
    if (!cloneSkinned) {
      throw new Error(
        `[scenoco] Model "${this.url}" was cloned before its loader finished. ` +
          'Await it first: `await loadAssets(theModel)`.',
      );
    }
    const copy = cloneSkinned(this.value.scene);
    // `Object3D.animations` is three.js's own field for exactly this, so an `Animator` on the
    // instance finds its clips without anyone having to keep a reference to the asset — and
    // without a `userData` key that only this engine would know to look under.
    if (this.clips.length > 0) copy.animations = [...this.clips];
    return copy;
  }

  protected override async fetch(): Promise<LoadedGltf> {
    // Imported here rather than at the top of the file so a project with no model ships neither
    // the glTF loader nor the skeleton utilities — both are three.js addons, and both are large.
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
