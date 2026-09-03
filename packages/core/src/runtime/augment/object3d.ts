import { MathUtils, Object3D, Vector3, type Material } from 'three';
import { Component } from '../Component.js';
import { SceneRuntime, teardownComponent, teardownObject } from '../SceneRuntime.js';
import type { NodeLifecycle } from '../types.js';

const { RAD2DEG, DEG2RAD } = MathUtils;


declare module 'three' {
  interface Object3D extends NodeLifecycle {
    // --- engine-internal state ---------------------------------------------------------
    /** @internal components attached to this object, in attach order. */
    _components: Component[] | null;
    /** @internal the runtime of the scene this object currently belongs to. */
    _runtime: SceneRuntime | null;
    /** @internal own active flag, as set by `setActive`. */
    _active: boolean;
    /** @internal cached `_active && parent._activeInHierarchy`, kept in step by `setActive`/`add`. */
    _activeInHierarchy: boolean;
    /** @internal */
    _destroyed: boolean;
    /** @internal */
    _pendingDestroy: boolean;
    /** @internal set by `instantiate` once `onLoad` has run. */
    _built: boolean;

    // --- GameObject surface -------------------------------------------------------------
    /** The scene this object currently belongs to, or `null` while detached. */
    readonly scene: Scene | null;
    /** True when this object is in a loaded scene, active, and every ancestor is active. */
    readonly activeInHierarchy: boolean;
    /** This object's own active flag, ignoring its ancestors. */
    readonly activeSelf: boolean;
    /**
     * True once this object has been destroyed. Never re-add a destroyed object.
     *
     * `isDestroyed` rather than `destroyed`: a prefab is an ordinary `Object3D` subclass now,
     * so every name this augmentation takes is a name an authored prefab cannot use.
     */
    readonly isDestroyed: boolean;
    /** Read-only view of the attached components. */
    readonly components: readonly Component[];

    /**
     * This node's local rotation in **degrees**, as a `Vector3` (Unity's
     * `Transform.eulerAngles`).
     *
     * Like `position`, `rotation` and `quaternion` — which Three.js creates once and hands
     * back as the *same* instance on every access — this returns one cached vector per node,
     * refreshed from `rotation` on each read. So `node.eulerAngles === node.eulerAngles`, and
     * reading in a loop allocates nothing.
     *
     * It follows that the value **aliases**, exactly as `position` does: hold on to it and it
     * changes under you. `const before = node.eulerAngles` is not a snapshot — use
     * `node.eulerAngles.clone()` for that.
     *
     * Writing a component is not writing through: `Vector3` has no change hook (`Euler` does,
     * which is how `rotation` keeps `quaternion` in sync), so `node.eulerAngles.y = 90` sets a
     * field the next read overwrites. Assign the whole vector instead —
     * `node.eulerAngles = new Vector3(0, 90, 0)` — the same rule Unity's
     * `Transform.eulerAngles` has.
     *
     * Degrees are the unit everywhere authored data appears; radians exist only on the live
     * `THREE.Euler` underneath.
     */
    eulerAngles: Vector3;

    /**
     * This node's **own** material, cloned from the shared one on first call — Unity's
     * `Renderer.material` (vs `sharedMaterial`), which exists for exactly this reason.
     *
     * A shared material is one object, so a prefab spawned fifty times
     * shares one material and mutating it recolours all fifty. That sharing is legible — it is
     * an `import` you can read — but it is still sharing, so this is how one node opts out.
     *
     * Idempotent. Throws when the node has no material (a `Group`, an empty node); handing
     * back nothing would just move the invisible bug.
     */
    uniqueMaterial<T extends Material | Material[] = Material>(): T;

    /**
     * Activate or deactivate this object. An inactive object stops receiving every component
     * hook and stops rendering (`visible` follows the flag), and so does its whole subtree.
     */
    setActive(value: boolean): this;

  }
}

const proto = Object3D.prototype;
const EMPTY: readonly Component[] = Object.freeze([]);

// Prototype-level defaults: an object that never touches the engine pays nothing for it.
proto._components = null;
proto._runtime = null;
proto._active = true;
proto._activeInHierarchy = false;
proto._destroyed = false;
proto._pendingDestroy = false;
proto._built = false;

/**
 * Every accessor below is `configurable`, so evaluating this module twice replaces the previous
 * definition instead of throwing.
 *
 * A module that patches a shared prototype has to survive being evaluated more than once: a dev
 * server re-serving it after an unrelated file changed is enough, and the failure is brutal —
 * `Cannot redefine property: scene` is thrown at import time, so whatever was importing the
 * engine never finishes loading and you are left staring at an
 * empty viewport with no obvious cause.
 */
Object.defineProperties(proto, {
  scene: {
    get(this: Object3D) {
      return this._runtime?.scene ?? null;
    },
    configurable: true,
  },
  activeInHierarchy: {
    get(this: Object3D) {
      return this._activeInHierarchy;
    },
    configurable: true,
  },
  activeSelf: {
    get(this: Object3D) {
      return this._active;
    },
    configurable: true,
  },
  isDestroyed: {
    get(this: Object3D) {
      return this._destroyed;
    },
    configurable: true,
  },
  components: {
    get(this: Object3D) {
      return this._components ?? EMPTY;
    },
    configurable: true,
  },
});

/**
 * One degrees-vector per node, mirroring how Three.js gives every `Object3D` its own
 * `position`/`rotation`/`quaternion` instance for the object's whole life. A WeakMap rather
 * than a constructor field because this is an augmentation — `Object3D`'s constructor is not
 * ours to add to — and it lets the entry die with the node.
 */
const eulerViews = new WeakMap<Object3D, Vector3>();

Object.defineProperty(proto, 'eulerAngles', {
  get(this: Object3D): Vector3 {
    let view = eulerViews.get(this);
    if (!view) eulerViews.set(this, (view = new Vector3()));
    // Refresh in place: same instance every read, current values every read.
    return view.set(this.rotation.x * RAD2DEG, this.rotation.y * RAD2DEG, this.rotation.z * RAD2DEG);
  },
  set(this: Object3D, degrees: Vector3) {
    this.rotation.set(degrees.x * DEG2RAD, degrees.y * DEG2RAD, degrees.z * DEG2RAD);
  },
  configurable: true,
});

/** Nodes whose material has already been cloned, so repeat calls don't pile up copies. */
const uniqueMaterials = new WeakSet<Object3D>();

proto.uniqueMaterial = function uniqueMaterial<T extends Material | Material[] = Material>(
  this: Object3D,
): T {
  const host = this as Object3D & { material?: Material | Material[] };
  const current = host.material;
  if (!current) {
    throw new Error(
      `[scenoco] uniqueMaterial(): <${this.type}>${this.name ? ` name="${this.name}"` : ''} has ` +
        'no material to clone. Only a node that carries one (a Mesh, a Sprite, …) does.',
    );
  }
  if (uniqueMaterials.has(this)) return current as T;
  // A multi-material mesh: every slot is shared, so every slot is cloned.
  host.material = Array.isArray(current) ? current.map((m) => m.clone()) : current.clone();
  uniqueMaterials.add(this);
  return host.material as T;
};

// --- activation ------------------------------------------------------------------------

/** Recompute `_activeInHierarchy` for a subtree, collecting the objects whose value flipped. */
export function markHierarchy(object: Object3D, parentActive: boolean, changed: Object3D[]): void {
  const next = object._active && parentActive;
  if (object._activeInHierarchy !== next) {
    object._activeInHierarchy = next;
    changed.push(object);
  }
  for (const child of object.children) markHierarchy(child, next, changed);
}

/** True when this object's parent (or the scene root) permits it to be live. */
export function parentActivity(object: Object3D): boolean {
  if (object.parent) return object.parent._activeInHierarchy;
  // A scene root is live once it has a runtime; a detached object never is.
  return object._runtime != null;
}

proto.setActive = function (this: Object3D, value: boolean): Object3D {
  if (this._active === value || this._destroyed) return this;
  this._active = value;
  // Rendering follows activation, so a deactivated object also disappears — use `.visible`
  // directly when you want to hide something that should keep updating.
  this.visible = value;

  const changed: Object3D[] = [];
  markHierarchy(this, parentActivity(this), changed);
  const runtime = this._runtime;
  // Flags for the whole subtree are settled before any hook runs, so a hook that inspects
  // another object in the same subtree sees the final state.
  if (runtime) for (const object of changed) runtime.refreshObject(object);
  return this;
} as Object3D['setActive'];
