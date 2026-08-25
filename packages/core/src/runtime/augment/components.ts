/**
 * The component half of the `Object3D` surface: attaching behaviour to a node and finding it
 * again.
 *
 * Each of these files declares the members it implements. The augmentation writes every name
 * twice — once as a documented signature in a `declare module` block, once as the function — so
 * one file held both halves of fifty members and read as the longest file in core while being
 * an ordinary amount of API. Split by concern, "where is `addComponent`" has an answer.
 */
import { Object3D } from 'three';
import { Component } from '../Component.js';
import { teardownComponent } from '../SceneRuntime.js';
import type { ComponentInit, ComponentType, ConstructableComponent, OwnerOf } from '../types.js';

declare module 'three' {
  interface Object3D {
    // --- components ---------------------------------------------------------------------
    /**
     * Construct a component, apply `init` to it, and attach it.
     *
     * ```ts
     * cube.addComponent(Bobber, { amplitude: 0.3, frequency: 0.5 });
     * ```
     *
     * `init` is applied before `awake` runs, so a component always wakes up configured.
     * `awake` fires immediately if the object is already live in a loaded scene, otherwise
     * as soon as it becomes live.
     *
     * A component that declares a required Three.js type — `class Flicker extends
     * Component<PointLight>` — can only be added to that type. Attaching it to a `Mesh` is a
     * compile error on the receiver, not a crash later.
     */
    addComponent<T extends Component>(
      this: OwnerOf<T>,
      type: ConstructableComponent<T>,
      init?: ComponentInit<T>,
    ): T;
    /** Attach an already-constructed component. It must not be attached elsewhere. */
    addComponent<T extends Component>(this: OwnerOf<T>, instance: T): T;

    /** First attached component that is an instance of `type`, or `null`. */
    getComponent<T extends Component>(type: ComponentType<T>): T | null;
    /** Every attached component that is an instance of `type`. */
    getComponents<T extends Component>(type: ComponentType<T>): T[];
    /** First matching component on this object or anywhere below it, depth-first. */
    getComponentInChildren<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T | null;
    /** Every matching component on this object and everything below it. */
    getComponentsInChildren<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T[];
    /**
     * First matching component on this object or any ancestor, starting here. Inactive objects
     * are skipped unless `includeInactive` — the same rule the children searches follow.
     */
    getComponentInParent<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T | null;
    /** Every matching component on this object and its ancestors, nearest first. */
    getComponentsInParent<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T[];
    /** True when a component of `type` is attached. */
    hasComponent(type: ComponentType): boolean;
    /** Get the component of `type`, creating and attaching one if it is missing. */
    requireComponent<T extends Component>(
      this: OwnerOf<T>,
      type: ConstructableComponent<T>,
      init?: ComponentInit<T>,
    ): T;
    /** Detach and destroy a component, by instance or by type. Returns true if one was removed. */
    removeComponent(target: Component | ComponentType): boolean;

  }
}

const proto = Object3D.prototype;

// --- components -------------------------------------------------------------------------

proto.addComponent = function (
  this: Object3D,
  typeOrInstance: ConstructableComponent | Component,
  init?: ComponentInit<Component>,
): Component {
  if (this._destroyed) {
    throw new Error('[scenoco] cannot add a component to a destroyed object');
  }
  const component = typeof typeOrInstance === 'function' ? new typeOrInstance() : typeOrInstance;

  if (!(component instanceof Component)) {
    throw new TypeError('[scenoco] addComponent expects a Component subclass or instance');
  }
  if (component._object3D) {
    throw new Error(
      `[scenoco] ${component.constructor.name} is already attached to "${component._object3D.name || '(unnamed)'}"`,
    );
  }

  component._object3D = this;
  (this._components ??= []).push(component);
  // Configure before registering: `add` is what fires `awake`, and a component should never
  // wake up looking at defaults it was about to have overwritten.
  if (init) Object.assign(component, init);
  this._runtime?.add(component);
  return component;
} as Object3D['addComponent'];

/**
 * The one place `instanceof` is used for component lookup. As a type predicate it hands the
 * narrowing back to the compiler, so nothing downstream needs a cast.
 */
function isType<T extends Component>(component: Component, type: ComponentType<T>): component is T {
  return component instanceof type;
}

proto.getComponent = function <T extends Component>(this: Object3D, type: ComponentType<T>): T | null {
  const components = this._components;
  if (!components) return null;
  for (const component of components) {
    if (isType(component, type)) return component;
  }
  return null;
};

proto.getComponents = function <T extends Component>(this: Object3D, type: ComponentType<T>): T[] {
  const found: T[] = [];
  const components = this._components;
  if (!components) return found;
  for (const component of components) {
    if (isType(component, type)) found.push(component);
  }
  return found;
};

/** Depth-first search that prunes inactive branches, which `Object3D.traverse` cannot do. */
function searchFirst<T extends Component>(
  object: Object3D,
  type: ComponentType<T>,
  includeInactive: boolean,
): T | null {
  if (!includeInactive && !object._active) return null;
  const own = object.getComponent(type);
  if (own) return own;
  for (const child of object.children) {
    const found = searchFirst(child, type, includeInactive);
    if (found) return found;
  }
  return null;
}

function searchAll<T extends Component>(
  object: Object3D,
  type: ComponentType<T>,
  includeInactive: boolean,
  out: T[],
): void {
  if (!includeInactive && !object._active) return;
  const components = object._components;
  if (components) {
    for (const component of components) {
      if (isType(component, type)) out.push(component);
    }
  }
  for (const child of object.children) searchAll(child, type, includeInactive, out);
}

proto.getComponentInChildren = function <T extends Component>(
  this: Object3D,
  type: ComponentType<T>,
  includeInactive = false,
): T | null {
  return searchFirst(this, type, includeInactive);
};

proto.getComponentsInChildren = function <T extends Component>(
  this: Object3D,
  type: ComponentType<T>,
  includeInactive = false,
): T[] {
  const found: T[] = [];
  searchAll(this, type, includeInactive, found);
  return found;
};

proto.getComponentInParent = function <T extends Component>(
  this: Object3D,
  type: ComponentType<T>,
  includeInactive = false,
): T | null {
  let current: Object3D | null = this;
  while (current) {
    // One rule for every query: an inactive object is not searched unless asked for. Letting
    // the parent walk ignore activity while the child walk honours it would be two rules for
    // one concept, and the wrong one is invisible until something returns a component that
    // should not have been there.
    if (!includeInactive && !current._active) return null;
    const component = current.getComponent(type);
    if (component) return component;
    current = current.parent;
  }
  return null;
};

proto.getComponentsInParent = function <T extends Component>(
  this: Object3D,
  type: ComponentType<T>,
  includeInactive = false,
): T[] {
  const found: T[] = [];
  let current: Object3D | null = this;
  while (current) {
    if (!includeInactive && !current._active) break;
    found.push(...current.getComponents(type));
    current = current.parent;
  }
  return found;
};

proto.hasComponent = function (this: Object3D, type: ComponentType): boolean {
  return this.getComponent(type) !== null;
};

proto.requireComponent = function (
  this: Object3D,
  type: ConstructableComponent,
  init?: ComponentInit<Component>,
): Component {
  return this.getComponent(type) ?? this.addComponent(type, init);
} as Object3D['requireComponent'];

proto.removeComponent = function (this: Object3D, target: Component | ComponentType): boolean {
  const component = target instanceof Component ? target : this.getComponent(target);
  if (!component || component._object3D !== this) return false;
  if (this._runtime) this._runtime.remove(component);
  else teardownComponent(component, null);
  return true;
};
