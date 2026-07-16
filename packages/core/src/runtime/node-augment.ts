import { Object3D } from 'three';
import type { Component } from './Component.js';
import type { Engine } from './Engine.js';

/**
 * Module augmentation that gives every Three.js node the component-manipulation
 * API (Unity `GameObject` / Cocos `Node` style). A node reaches its components
 * through `_engine`, a back-reference the engine stamps when the node enters a
 * scene (see `Engine.indexObjects` / `registerComponent`). `Component` has no
 * `getComponent*` of its own — a component queries its siblings via `this.node`,
 * exactly as Unity's `Component.GetComponent` forwards to its `gameObject`.
 *
 * Importing this file for its side effect patches `Object3D.prototype`; the
 * engine does so, so anything that touches the engine gets the methods.
 *
 * **Scene attachment.** Every method here requires the node to belong to an
 * engine. A hand-built node (`new Group()`) that hasn't been added to a loaded
 * scene or spawned has no engine yet, so calls throw a clear error rather than
 * silently reading empty — the classic trap. Guard with {@link Object3D.isSceneAttached}
 * when a node's attachment is genuinely uncertain.
 *
 * Destroyed-but-not-yet-flushed components are omitted from every result here, so
 * the node queries agree with {@link Engine.findComponent}: once `c.destroy()`
 * runs, `node.getComponent(C)` no longer returns `c`, even within the same tick.
 */
declare module 'three' {
  interface Object3D {
    /**
     * @internal Owning engine, stamped when the node enters a scene. `undefined`
     * on a node that isn't part of any engine yet. Prefer the public
     * {@link Object3D.isSceneAttached} to test attachment.
     */
    _engine?: Engine;

    /** Whether this node belongs to an engine's scene — i.e. the component API below is usable. */
    readonly isSceneAttached: boolean;

    /** First live component of the given type on this node, or null (Unity/Cocos style). */
    getComponent<T extends Component>(type: abstract new () => T): T | null;
    /** Every live component on this node (a fresh snapshot; `[]` when none). */
    getComponents(): readonly Component[];
    /**
     * First live component of the given type on this node or any descendant, or
     * null (Unity `GetComponentInChildren` — includes self). Depth-first.
     */
    getComponentInChildren<T extends Component>(type: abstract new () => T): T | null;
    /**
     * Every live component of the given type on this node and its descendants
     * (Unity `GetComponentsInChildren` — includes self). Returns `[]` when none.
     */
    getComponentsInChildren<T extends Component>(type: abstract new () => T): T[];

    /**
     * Attach a component to this node, by constructor or registered name
     * (Unity/Cocos `AddComponent`). Runs onLoad (and onEnable if enabled); start
     * runs on the next tick.
     */
    addComponent<T extends Component>(type: new () => T, props?: Partial<T>): T;
    addComponent(type: string, props?: Record<string, unknown>): Component;

    /**
     * Remove a component from this node (Cocos `Node.removeComponent`) — the
     * node-side equivalent of `component.destroy()`. **Deferred**, like every
     * SceNoCo destroy: the component is marked at once (every phase skips it from
     * here on) and torn down (onDisable/onDestroy) when the engine flushes at end
     * of tick, so removing one inside a hook is safe.
     */
    removeComponent(instance: Component): void;
  }
}

/**
 * The engine that owns `node`, or `undefined`. A node gets its own `_engine`
 * stamp when it's indexed (scene load / instantiate) or when a component is
 * attached to it; a hand-built node added under `engine.scene` has none of its
 * own, so we walk up to the first ancestor that does (the scene root is stamped
 * by the engine). This is what lets `cube.addComponent(...)` work the moment the
 * cube is in the scene tree, without a separate registration step.
 */
function resolveEngine(node: Object3D): Engine | undefined {
  for (let o: Object3D | null = node; o; o = o.parent) {
    if (o._engine) return o._engine;
  }
  return undefined;
}

/**
 * The owning engine, or a loud, actionable error naming the method and the fix.
 * Every node component method routes through here so "used a node before it was
 * in the scene" fails the same clear way everywhere, instead of a silent null.
 */
function requireEngine(node: Object3D, method: string): Engine {
  const engine = resolveEngine(node);
  if (!engine) {
    throw new Error(
      `Object3D.${method}() requires the node to be in an engine's scene — add it under engine.scene ` +
        `(or load/instantiate it) first. Check node.isSceneAttached when attachment is uncertain.`,
    );
  }
  return engine;
}

Object.defineProperty(Object3D.prototype, 'isSceneAttached', {
  get(this: Object3D): boolean {
    return resolveEngine(this) !== undefined;
  },
  configurable: true,
});

Object3D.prototype.getComponent = function getComponent<T extends Component>(
  this: Object3D,
  type: abstract new () => T,
): T | null {
  for (const c of requireEngine(this, 'getComponent').getComponents(this)) {
    if (!c._destroyed && c instanceof type) return c as T;
  }
  return null;
};

Object3D.prototype.getComponents = function getComponents(this: Object3D): readonly Component[] {
  return requireEngine(this, 'getComponents')
    .getComponents(this)
    .filter((c) => !c._destroyed);
};

Object3D.prototype.getComponentInChildren = function getComponentInChildren<T extends Component>(
  this: Object3D,
  type: abstract new () => T,
): T | null {
  const engine = requireEngine(this, 'getComponentInChildren');
  let found: T | null = null;
  this.traverse((object) => {
    if (found) return;
    for (const c of engine.getComponents(object)) {
      if (!c._destroyed && c instanceof type) {
        found = c as T;
        return;
      }
    }
  });
  return found;
};

Object3D.prototype.getComponentsInChildren = function getComponentsInChildren<T extends Component>(
  this: Object3D,
  type: abstract new () => T,
): T[] {
  const engine = requireEngine(this, 'getComponentsInChildren');
  const out: T[] = [];
  this.traverse((object) => {
    for (const c of engine.getComponents(object)) if (!c._destroyed && c instanceof type) out.push(c as T);
  });
  return out;
};

Object3D.prototype.addComponent = function addComponent<T extends Component>(
  this: Object3D,
  type: (new () => T) | string,
  props?: Partial<T>,
): T {
  return requireEngine(this, 'addComponent').addComponent(this, type as new () => T, props);
};

Object3D.prototype.removeComponent = function removeComponent(this: Object3D, instance: Component): void {
  requireEngine(this, 'removeComponent').destroyComponent(instance);
};
