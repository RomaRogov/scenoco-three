/**
 * `instantiate`: the prefab half of the `Object3D` surface.
 */
import { Object3D } from 'three';
import { Model, cloneTree } from '../../assets/Model.js';
import { Component } from '../Component.js';
import type { PrefabInit, PrefabPlacement, PrefabType } from '../types.js';
import { recordCopies } from './lifetime.js';

declare module 'three' {
  interface Object3D {
    // --- prefabs --------------------------------------------------------------------------
    /**
     * Create an instance of a prefab, configure it, and add it under this object.
     *
     * A prefab is any `Object3D` subclass that builds itself in `onLoad`, with no base class and no
     * wrapper node.
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
    /**
     * Copy a node that already exists — its whole subtree and every component on it — and add
     * the copy under this object: Unity's `Instantiate(original)`.
     *
     * Each component is a new instance of its class holding the original's values. A reference
     * to a node or component inside the copied subtree points at its copy; one outside it is
     * kept. What a component builds in its own field initializers — an `Event`, a `Map`, a
     * material made there — stays the copy's own. Geometry and materials the nodes hold are
     * shared, as a Unity asset is. The copy is active only if the original is, so an inactive
     * template gives an inactive copy: `setActive(true)` it. Given one of a node's components,
     * the whole node is copied and that component's copy is what comes back.
     */
    instantiate<T extends Object3D | Component>(
      original: T,
      init?: PrefabPlacement,
      configure?: (instance: T) => void,
    ): T;

  }
}

const proto = Object3D.prototype;

// --- prefabs --------------------------------------------------------------------------------

proto.instantiate = function <T extends Object3D>(
  this: Object3D,
  source: PrefabType<T> | Model | Object3D | Component,
  init?: PrefabInit<T>,
  configure?: (instance: never) => void,
): Object3D | Component {
  const settle = configure as ((instance: unknown) => void) | undefined;
  if (source instanceof Object3D || source instanceof Component) {
    const node = source instanceof Component ? source.object3D : source;
    const { root, components } = duplicate(node);
    const result = source instanceof Component ? components.get(source)! : root;
    if (init) place(root, init);
    if (init?.id) claimId(this, root, init.id);
    settle?.(result);
    this.add(root);
    return result;
  }
  // A model is already built, so it needs placing and adding and nothing else.
  if (source instanceof Model) {
    const instance = source.instantiate();
    if (init) place(instance, init);
    if (init?.id) claimId(this, instance, init.id);
    settle?.(instance);
    instance._built = true;
    this.add(instance);
    return instance;
  }

  const prefab = new source();
  // Settings first: the `onLoad` below builds the prefab out of these fields.
  if (init) assignSettings(prefab, init);

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

  // Before `configure` runs, so the instance answers to its id from inside it — the scene's to
  // keep from here, and teardown forgets it with the node. Registered through the parent, which
  // is the one already in a scene.
  if (init?.id) claimId(this, prefab, init.id);

  // The prefab's contents exist and nothing has woken up, so a value written now is the one
  // every `awake` below sees. After the `add` it would be too late.
  settle?.(prefab);

  this.add(prefab);
  prefab.onLoaded?.();
  return prefab;
} as Object3D['instantiate'];

/**
 * Give the new node its id, now or as soon as there is a scene to give it to.
 *
 * A spawn is often made under a parent that is not in a scene yet — a prefab assembling its own
 * contents, a subtree built before the one `add` that brings it in — and `registerId` had
 * nowhere to write, so the id was dropped in silence: `scene.byId` came back null for a node
 * that plainly carries the name, and the duplicate this documents as throwing never did.
 */
function claimId(parent: Object3D, node: Object3D, id: string): void {
  const runtime = parent._runtime;
  if (runtime) runtime.registerId(id, node);
  else node._pendingId = id;
}

/** Everything in an init that is **not** placement: the prefab's own fields. */
function assignSettings(node: Object3D, init: PrefabInit<Object3D> | PrefabPlacement): void {
  const { id, name, position, eulerAngles, scale, visible, active, ...settings } = init;
  void id;
  void name;
  void position;
  void eulerAngles;
  void scale;
  void visible;
  void active;
  Object.assign(node, settings);
}

/**
 * Where a freshly-made node goes. Copied into the live objects rather than assigned over them:
 * `position` and `scale` are three.js's own per-node vectors.
 */
function place(node: Object3D, init: PrefabInit<Object3D> | PrefabPlacement): void {
  const { name, position, eulerAngles, scale, visible, active } = init;
  if (name !== undefined) node.name = name;
  if (position !== undefined) node.position.copy(position);
  if (eulerAngles !== undefined) node.eulerAngles = eulerAngles;
  if (scale !== undefined) {
    if (typeof scale === 'number') node.scale.setScalar(scale);
    else node.scale.copy(scale);
  }
  if (visible !== undefined) node.visible = visible;
  // Before the `add`, so an inactive spawn never wakes until it is turned on.
  if (active !== undefined) node.setActive(active);
}

/**
 * A detached copy of `original`'s subtree — `clone()`, which carries every component, its enabled
 * state and the node's activity — with the references inside it pointed at the copy, as Unity's
 * `Instantiate` does. Nothing in it has woken: it wakes on `add`.
 */
function duplicate(original: Object3D): { root: Object3D; components: Map<Component, Component> } {
  const { result: root, copies } = recordCopies(() => cloneTree(original));
  // A reference to something inside the copied subtree is to its copy; one outside stays.
  const remap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remap);
    if (value instanceof Object3D) return copies.nodes.get(value) ?? value;
    if (value instanceof Component) return copies.components.get(value) ?? value;
    return value;
  };
  for (const copy of copies.components.values()) {
    const fields = copy as unknown as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
      if (!key.startsWith('_')) fields[key] = remap(fields[key]);
    }
  }
  return { root, components: copies.components };
}
