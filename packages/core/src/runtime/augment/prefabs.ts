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
     * Create an instance of a prefab, configure it, and add it under this object. A prefab is
     * any `Object3D` subclass that builds itself in `onLoad`, with no base class and no
     * wrapper node. To duplicate an object that already exists, use `clone()`.
     *
     * Settings, then `onLoad`, then placement, then the scene graph — so every `awake` below
     * fires once, with the transform already final.
     *
     * `configure` is the **override seam**: it runs while the prefab's insides exist and
     * nothing has woken up, which is where a spawn changes what the prefab declared.
     */
    instantiate<T extends Object3D>(
      type: PrefabType<T>,
      init?: PrefabInit<T>,
      configure?: (instance: T) => void,
    ): T;
    /**
     * Spawn a loaded glTF model — the same verb and the same placement as a prefab, except
     * that the file has to have arrived first.
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
  // A model is already built, so it needs placing and adding and nothing else.
  if (source instanceof Model) {
    const instance = source.instantiate();
    if (init) place(instance, init);
    configure?.(instance);
    instance._built = true;
    this.add(instance);
    if (init?.id) instance._runtime?.registerId(init.id, instance);
    return instance;
  }

  const prefab = new source();
  // Settings first: the `onLoad` below builds the prefab out of these fields.
  if (init) settle(prefab, init);

  // Built while detached, so the whole subtree arrives in one `add`.
  const built = prefab.onLoad?.();
  if (built instanceof Promise) {
    // Nowhere to await: the alternative is a node that enters the scene half-built.
    console.error(
      `[scenoco] ${source.name}.onLoad() returned a promise. instantiate() is synchronous, so ` +
        'the prefab is incomplete. Load what it needs in the scene and pass it in.',
    );
  }
  prefab._built = true;

  // Placement lands **after** `onLoad`, so the caller's position wins over the one the prefab
  // sets for itself — as Unity's `Instantiate(prefab, position, rotation)` does. Still before
  // the `add`, so the transform is final before any `awake`.
  if (init) place(prefab, init);

  // The prefab's contents exist and nothing has woken up, so a value written now is the one
  // every `awake` below sees. After the `add` it would be too late.
  configure?.(prefab);

  this.add(prefab);
  // Once it is in a scene: an id is the scene's to keep, and teardown forgets it with the node.
  if (init?.id) prefab._runtime?.registerId(init.id, prefab);
  prefab.onLoaded?.();
  return prefab;
} as Object3D['instantiate'];

/** Everything in an init that is **not** placement: the prefab's own fields. */
function settle(node: Object3D, init: PrefabInit<Object3D> | PrefabPlacement): void {
  const { id, name, position, eulerAngles, scale, visible, ...settings } = init;
  void id;
  void name;
  void position;
  void eulerAngles;
  void scale;
  void visible;
  Object.assign(node, settings);
}

/**
 * Where a freshly-made node goes. Copied into the live objects rather than assigned over them:
 * `position` and `scale` are three.js's own per-node vectors.
 */
function place(node: Object3D, init: PrefabInit<Object3D> | PrefabPlacement): void {
  const { name, position, eulerAngles, scale, visible } = init;
  if (name !== undefined) node.name = name;
  if (position !== undefined) node.position.copy(position);
  if (eulerAngles !== undefined) node.eulerAngles = eulerAngles;
  if (scale !== undefined) {
    if (typeof scale === 'number') node.scale.setScalar(scale);
    else node.scale.copy(scale);
  }
  if (visible !== undefined) node.visible = visible;
}
