/**
 * The component half of the `Object3D` surface: attaching behaviour to a node, and finding it
 * again. Each file in here declares the members it implements.
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
     * `init` lands before `awake`, so a component always wakes up configured. `awake` fires at
     * once if the object is already live in a loaded scene, otherwise as soon as it becomes so.
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
    /** First matching component on this object or any ancestor, starting here. */
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
  // Before registering: `add` fires `awake`, which must not see defaults about to be replaced.
  if (init) Object.assign(component, init);
  this._runtime?.add(component);
  return component;
} as Object3D['addComponent'];

/** The one place `instanceof` is used for lookup; as a predicate it saves every caller a cast. */
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
    // One rule for every query: an inactive object is not searched unless asked for.
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
