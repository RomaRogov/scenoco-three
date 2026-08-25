/**
 * `instantiate`: the prefab half of the `Object3D` surface.
 */
import { Object3D } from 'three';
import { Model } from '../../assets/Model.js';
import type { PrefabInit, PrefabPlacement, PrefabType } from '../types.js';

declare module 'three' {
  interface Object3D {
    // --- prefabs --------------------------------------------------------------------------
    /**
     * Create an instance of a prefab, configure it, and add it under this object.
     *
     * ```ts
     * spawnRoot.instantiate(Crate, { position: new Vector3(0, 1, 0), size: 0.5 });
     * ```
     *
     * A prefab is any `Object3D` subclass that builds itself in `onLoad` — there is no base
     * class and no wrapper node, so a prefab rooted at a mesh instantiates as a real `Mesh`.
     *
     * Placement and settings are applied, then `onLoad` runs, and only then does the prefab
     * enter the scene graph — so every `awake` below it fires exactly once, with the transform
     * already final. An instantiated prefab is indistinguishable from one authored in place.
     *
     * To duplicate an object that already exists, use `clone()` instead.
     *
     * `configure` is the **override seam**: it runs after the prefab has built itself and
     * before it enters the scene, which is the one window in which its insides exist but
     * nothing in it has woken up yet. That is where a spawn reaches into a prefab and changes
     * something it declared — a label's text, a brick's colour — and it is what a document's
     * `<Override target="#label" text="…">` compiles to.
     *
     * ```ts
     * parent.instantiate(BrickPrefab, { position }, (brick) => { brick.hits = 3; });
     * ```
     */
    instantiate<T extends Object3D>(
      type: PrefabType<T>,
      init?: PrefabInit<T>,
      configure?: (instance: T) => void,
    ): T;
    /**
     * Spawn a loaded glTF model. A model *is* a prefab — the same verb, the same placement, no
     * wrapper node — so the only difference is that the file has to have arrived first.
     *
     * ```ts
     * this.instantiate(heroModel, { position: new Vector3(0, 1, 0) });
     * ```
     */
    instantiate(
      model: Model,
      init?: PrefabPlacement,
      configure?: (instance: Object3D) => void,
    ): Object3D;

  }
}

const proto = Object3D.prototype;

// --- prefabs --------------------------------------------------------------------------------

proto.instantiate = function <T extends Object3D>(
  this: Object3D,
  source: PrefabType<T> | Model,
  init?: PrefabInit<T>,
  configure?: (instance: Object3D) => void,
): Object3D {
  // A model is a prefab that came from a file: it is already built, so it needs placing and
  // adding and nothing else. Everything after this point is the same for both.
  if (source instanceof Model) {
    const instance = source.instantiate();
    if (init) place(instance, init);
    configure?.(instance);
    instance._built = true;
    this.add(instance);
    return instance;
  }

  const prefab = new source();
  if (init) place(prefab, init);

  // Built while detached, so the whole subtree arrives in one `add` and `awake` runs once per
  // component, with the prefab's transform already final.
  const built = prefab.onLoad?.();
  if (built instanceof Promise) {
    // `instantiate` hands back a finished node; there is nowhere to await. Saying so is the
    // only honest option — the alternative is a node that enters the scene half-built.
    console.error(
      `[scenoco] ${source.name}.onLoad() returned a promise. instantiate() is synchronous, so ` +
        'the prefab is incomplete. Load what it needs in the scene and pass it in.',
    );
  }
  prefab._built = true;

  // Overrides land here: the prefab's contents exist, and nothing in it has woken up yet, so a
  // value written now is the value every `awake` below sees. After the `add` it would already
  // be too late for anything read in `awake`, which is most of what a component caches.
  configure?.(prefab);

  this.add(prefab);
  prefab.onLoaded?.();
  return prefab;
} as Object3D['instantiate'];

/**
 * Apply placement and settings to a freshly-made node.
 *
 * Destructured rather than `Object.assign`-ed wholesale: `position` and `scale` are live
 * `Vector3`s three.js hands out once per node, and `eulerAngles` is a degrees view with a
 * setter — replacing any of them outright would detach the node from its own transform.
 * Placement is copied into the existing objects; the rest is plain assignment.
 */
function place(node: Object3D, init: PrefabInit<Object3D> | PrefabPlacement): void {
  const { name, position, eulerAngles, scale, visible, ...settings } = init;
  if (name !== undefined) node.name = name;
  if (position !== undefined) node.position.copy(position);
  if (eulerAngles !== undefined) node.eulerAngles = eulerAngles;
  if (scale !== undefined) {
    if (typeof scale === 'number') node.scale.setScalar(scale);
    else node.scale.copy(scale);
  }
  if (visible !== undefined) node.visible = visible;
  Object.assign(node, settings);
}
