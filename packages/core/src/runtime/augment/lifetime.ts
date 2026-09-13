/** Destruction, and the two doors into the scene graph. */
import { Object3D } from 'three';
import { Component } from '../Component.js';
import { teardownObject } from '../SceneRuntime.js';
import { markHierarchy, parentActivity } from './object3d.js';
import type { ConstructableComponent } from '../types.js';

declare module 'three' {
  interface Object3D {
    // --- lifetime -------------------------------------------------------------------------
    /**
     * Destroy this object and its subtree at the end of the current frame. Components get
     * `onDisable` then `onDestroy`, and the object is removed from its parent.
     */
    destroy(): void;
    /** Destroy immediately instead of at the end of the frame. Avoid calling this from a hook. */
    destroyImmediate(): void;
  }
}

const proto = Object3D.prototype;

// --- lifetime ------------------------------------------------------------------------------

proto.destroy = function (this: Object3D): void {
  if (this._destroyed) return;
  if (this._runtime) this._runtime.removeObject(this);
  else teardownObject(this, null);
};

proto.destroyImmediate = function (this: Object3D): void {
  teardownObject(this, this._runtime);
};

// --- scene graph interception ---------------------------------------------------------------
//
// `attach`, `clear`, `copy` and `removeFromParent` all funnel through `add` and `remove`, so
// patching the pair keeps the component registry correct with nothing registered by hand.

const originalAdd = proto.add;
const originalRemove = proto.remove;
const originalCopy = proto.copy;

// `clone()` is `new this.constructor().copy(this)`, so extending `copy` is what carries
// components. Not `userData`: three.js copies that through JSON, which throws on a component's
// back-reference to its object and would flatten its `Vector3` fields if it did not.
proto.copy = function (this: Object3D, source: Object3D, recursive = true): Object3D {
  originalCopy.call(this, source, recursive);

  const sourceComponents = source._components;
  if (sourceComponents) {
    for (const component of sourceComponents) {
      if (component._pendingDestroy) continue;
      const constructor = component.constructor as ConstructableComponent;
      this.addComponent(new constructor().copy(component as never));
    }
  }

  // A clone already holds its contents, so it must not be reported as unbuilt.
  this._built = source._built;
  return this;
} as Object3D['copy'];

/** Set while `add` reparents within one scene, so the intermediate `remove` skips teardown. */
let reparenting: Object3D | null = null;

proto.add = function (this: Object3D, ...objects: Object3D[]): Object3D {
  if (objects.length > 1) {
    for (const object of objects) this.add(object);
    return this;
  }
  const object = objects[0];
  if (!object || object === this || !object.isObject3D) {
    return originalAdd.call(this, object as Object3D);
  }
  if (object._destroyed) {
    console.warn('[scenoco] ignoring add() of a destroyed object:', object.name || object.uuid);
    return this;
  }

  // Moving inside one scene must not fire onDisable/onEnable, so suppress the detach that
  // `removeFromParent` triggers inside the original `add`.
  const sameRuntime = object._runtime != null && object._runtime === this._runtime;
  if (sameRuntime) reparenting = object;
  try {
    originalAdd.call(this, object);
  } finally {
    reparenting = null;
  }

  if (object.parent !== this) return this; // three.js refused the add

  const runtime = this._runtime;
  if (runtime) {
    runtime.registerSubtree(object);
  } else {
    // Not in a scene yet: still keep the cached activity flags of the subtree honest.
    markHierarchy(object, parentActivity(object), []);
  }
  return this;
} as Object3D['add'];

proto.remove = function (this: Object3D, ...objects: Object3D[]): Object3D {
  if (objects.length > 1) {
    for (const object of objects) this.remove(object);
    return this;
  }
  const object = objects[0];
  const wasChild = object != null && object.parent === this;
  originalRemove.call(this, object as Object3D);
  if (!wasChild || object.parent === this) return this;

  if (object === reparenting) return this; // mid-flight move inside the same scene

  const runtime = object._runtime;
  if (runtime) runtime.unregisterSubtree(object);
  markHierarchy(object, false, []);
  return this;
} as Object3D['remove'];
