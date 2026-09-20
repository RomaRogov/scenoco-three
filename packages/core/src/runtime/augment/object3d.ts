import { MathUtils, Object3D, Vector3 } from 'three';
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
    _isActive: boolean;
    /** @internal cached `_isActive && parent._activeInHierarchy`, kept in step by `setActive`/`add`. */
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
    /** True once this object has been destroyed. Never re-add a destroyed object. */
    readonly isDestroyed: boolean;
    /** Read-only view of the attached components. */
    readonly components: readonly Component[];

    /**
     * This node's local rotation in **degrees** — Unity's `Transform.eulerAngles`. Radians
     * exist only on the live `THREE.Euler` underneath.
     *
     * A live view onto `rotation`, the way `position` is a live vector: one instance per node,
     * writes of any kind land on the node, and it is never a snapshot. Clone it to keep one.
     */
    eulerAngles: Vector3;

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
proto._isActive = true;
proto._activeInHierarchy = false;
proto._destroyed = false;
proto._pendingDestroy = false;
proto._built = false;

/**
 * Every accessor below is `configurable`, so evaluating this module twice replaces the previous
 * definition instead of throwing `Cannot redefine property` at import time — which a dev server
 * re-serving the module is enough to cause.
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
      return this._isActive;
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
 * A `Vector3` whose components *are* the node's rotation, in degrees.
 *
 * `x`, `y` and `z` are accessors onto the node (installed below, because a class body may not
 * override a base class's property with one), so every `Vector3` method writes through for free
 * and so does `view.y = 90`. A plain vector refreshed on each read would take that assignment
 * and lose it on the next read.
 */
class EulerDegrees extends Vector3 {
  /** Unset while `Vector3`'s own constructor runs, which assigns through the accessors. */
  readonly node: Object3D | undefined;

  constructor(node: Object3D) {
    super();
    this.node = node;
  }

  // Three axes in one `Euler.set` rather than three assignments: the euler syncs the node's
  // quaternion on every change, and a whole-vector write is one change.
  override set(x: number, y: number, z: number): this {
    this.node?.rotation.set(x * DEG2RAD, y * DEG2RAD, z * DEG2RAD);
    return this;
  }

  override copy(v: Vector3): this {
    return this.set(v.x, v.y, v.z);
  }

  /**
   * A detached snapshot, and a plain `Vector3` — a second live view of the same node would be
   * two names for one value.
   *
   * `Vector3.clone` is `new this.constructor(x, y, z)`, which here would pass a number where the
   * node goes, so this cannot be inherited.
   */
  override clone(): this {
    return new Vector3(this.x, this.y, this.z) as this;
  }
}

for (const axis of ['x', 'y', 'z'] as const) {
  Object.defineProperty(EulerDegrees.prototype, axis, {
    get(this: EulerDegrees): number {
      return this.node ? this.node.rotation[axis] * RAD2DEG : 0;
    },
    set(this: EulerDegrees, degrees: number) {
      if (this.node) this.node.rotation[axis] = degrees * DEG2RAD;
    },
    configurable: true,
  });
}

/** One view per node, as three.js gives each object its own `position`. */
const eulerViews = new WeakMap<Object3D, EulerDegrees>();

Object.defineProperty(proto, 'eulerAngles', {
  get(this: Object3D): Vector3 {
    let view = eulerViews.get(this);
    if (!view) eulerViews.set(this, (view = new EulerDegrees(this)));
    return view;
  },
  set(this: Object3D, degrees: Vector3) {
    this.rotation.set(degrees.x * DEG2RAD, degrees.y * DEG2RAD, degrees.z * DEG2RAD);
  },
  configurable: true,
});

// --- activation ------------------------------------------------------------------------

/** Recompute `_activeInHierarchy` for a subtree, collecting the objects whose value flipped. */
export function markHierarchy(object: Object3D, parentActive: boolean, changed: Object3D[]): void {
  const next = object._isActive && parentActive;
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
  if (this._isActive === value || this._destroyed) return this;
  this._isActive = value;
  // Rendering follows activation. To hide something that keeps updating, use `.visible`.
  this.visible = value;

  const changed: Object3D[] = [];
  markHierarchy(this, parentActivity(this), changed);
  const runtime = this._runtime;
  // The whole subtree settles before any hook runs, so a hook sees the final state.
  if (runtime) for (const object of changed) runtime.refreshObject(object);
  return this;
} as Object3D['setActive'];
