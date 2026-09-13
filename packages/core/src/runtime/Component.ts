import type { Object3D, Scene } from 'three';
import type {
  ComponentLifecycle,
  ComponentType,
  ConstructableSystem,
  SystemInit,
  SystemType,
} from './types.js';
import type { System } from './System.js';
import { Coroutine, type Yieldable } from './Coroutine.js';
import type { Event } from './Event.js';

/** @internal lifecycle phases a component moves through, in order. */
export const ComponentState = {
  /** Constructed, not yet part of a loaded scene. */
  Created: 0,
  /** `awake` has run. */
  Awake: 1,
  /** `start` has run. */
  Started: 2,
  /** `onDestroy` has run. The instance is inert from here on. */
  Destroyed: 3,
} as const;

export type ComponentState = (typeof ComponentState)[keyof typeof ComponentState];

/** The per-value rules behind {@link Component.copy}. */
function copyValue(value: unknown, owner: string, key: string): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => copyValue(entry, owner, key));

  const candidate = value as { isObject3D?: boolean; dispose?: unknown; clone?: () => unknown };
  // A reference to another object in the scene stays a reference.
  if (candidate.isObject3D === true) return value;
  // Anything disposable is a GPU resource: shared, never duplicated.
  if (typeof candidate.dispose === 'function') return value;
  // Value objects get duplicated so the copy owns its own.
  if (typeof candidate.clone === 'function') return candidate.clone();
  // So does plain data — a `Map` of counters is this component's, not every clone's.
  if (isPlainData(value)) {
    try {
      return structuredClone(value);
    } catch {
      // A function or a DOM node somewhere inside it. Shared, and said out loud.
    }
  }
  warnShared(owner, key, value);
  return value;
}

/** Data with no identity of its own: a literal, a collection, a date, a buffer. */
function isPlainData(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return (
    prototype === Object.prototype ||
    prototype === null ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    ArrayBuffer.isView(value)
  );
}

/** Fields already reported, so a clone in a loop says it once. */
const reportedShares = new Set<string>();

/**
 * A value none of the rules can duplicate, so both components now hold the same one.
 *
 * Almost always a mistake, and an invisible one: the clone changes a field and the original
 * changes with it. A component that owns something unclonable should build it in `awake`.
 */
function warnShared(owner: string, key: string, value: object): void {
  const id = `${owner}.${key}`;
  if (reportedShares.has(id)) return;
  reportedShares.add(id);
  console.warn(
    `[scenoco] ${id} holds a ${value.constructor?.name ?? 'value'} that cannot be copied, so ` +
      'every clone shares this one. Build it in awake() to give each instance its own, or ' +
      'override copy().',
  );
}

/**
 * Base class for all behaviour. Extend it, declare the settings as public fields, implement the
 * hooks you need, and attach it with `object3D.addComponent(MyComponent)`.
 *
 * `TObject` says what kind of node this expects underneath and types `this.object3D` as that
 * class — `Component<PointLight>` cannot be added to a `Mesh`.
 *
 * Every hook is optional, and a component is ticked only for the hooks it defines. Constructors
 * take no arguments: the engine constructs, applies `init`, then calls `awake`.
 */
export abstract class Component<TObject extends Object3D = Object3D> {
  /** @internal set by `Object3D.addComponent` immediately after construction. */
  _object3D: TObject = null!;
  /** @internal */
  _state: ComponentState = ComponentState.Created;
  /** @internal true while the component counts as running (enabled + object active + in a scene). */
  _active = false;
  /** @internal */
  _enabled = true;
  /** @internal queued for destruction at the end of the frame. */
  _pendingDestroy = false;
  /** @internal live coroutines owned by this component. */
  _coroutines: Coroutine[] | null = null;
  /** @internal `off` thunks for the events `listen` subscribed to. */
  _subscriptions: (() => void)[] | null = null;

  /**
   * The `THREE.Object3D` this component is attached to — a real three.js object, not a wrapper.
   * Valid from `awake` onwards.
   */
  get object3D(): TObject {
    return this._object3D;
  }

  /** The scene this component currently lives in, or `null` while detached. */
  get scene(): Scene | null {
    return this._object3D?.scene ?? null;
  }

  /**
   * Whether this component participates in the update loop. Toggling it fires
   * `onEnable` / `onDisable` when the object itself is active in a loaded scene.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (this._enabled === value || this._state === ComponentState.Destroyed) return;
    this._enabled = value;
    this._object3D?._runtime?.refreshComponent(this);
  }

  /**
   * True when the component is enabled, its object active in hierarchy and its scene loaded —
   * exactly when it receives ticks. Unity's `Behaviour.isActiveAndEnabled`.
   */
  get isActiveAndEnabled(): boolean {
    return this._active && !this._pendingDestroy;
  }

  /**
   * True once `onDestroy` has run. `isDestroyed` rather than `destroyed`, which leaves the
   * plain word free for the event a component is likely to declare.
   */
  get isDestroyed(): boolean {
    return this._state === ComponentState.Destroyed;
  }

  // --- convenience passthroughs to the owning object ------------------------------------

  /** Shorthand for `this.object3D.getComponent(type)`. */
  getComponent<T extends Component>(type: ComponentType<T>): T | null {
    return this._object3D.getComponent(type);
  }

  /** Shorthand for `this.object3D.getComponents(type)`. */
  getComponents<T extends Component>(type: ComponentType<T>): T[] {
    return this._object3D.getComponents(type);
  }

  /** Shorthand for `this.object3D.getComponentInChildren(type, includeInactive)`. */
  getComponentInChildren<T extends Component>(
    type: ComponentType<T>,
    includeInactive?: boolean,
  ): T | null {
    return this._object3D.getComponentInChildren(type, includeInactive);
  }

  /** Shorthand for `this.object3D.getComponentsInChildren(type, includeInactive)`. */
  getComponentsInChildren<T extends Component>(
    type: ComponentType<T>,
    includeInactive?: boolean,
  ): T[] {
    return this._object3D.getComponentsInChildren(type, includeInactive);
  }

  /** Shorthand for `this.object3D.getComponentInParent(type, includeInactive)`. */
  getComponentInParent<T extends Component>(
    type: ComponentType<T>,
    includeInactive?: boolean,
  ): T | null {
    return this._object3D.getComponentInParent(type, includeInactive);
  }

  /** Shorthand for `this.object3D.getComponentsInParent(type, includeInactive)`. */
  getComponentsInParent<T extends Component>(
    type: ComponentType<T>,
    includeInactive?: boolean,
  ): T[] {
    return this._object3D.getComponentsInParent(type, includeInactive);
  }

  // --- systems -------------------------------------------------------------------------

  /** Shorthand for `this.scene?.getSystem(type)`. Null when there is no such system, or no scene. */
  getSystem<T extends System>(type: SystemType<T>): T | null {
    return this.scene?.getSystem(type) ?? null;
  }

  /**
   * The scene's system of this class, created if this is the first component to ask — how a
   * component reaches a scene-level service, usually as `requireSystem(X).add(this)` in `awake`.
   *
   * Throws on a detached node, which has no scene to hold the system.
   */
  requireSystem<T extends System>(type: ConstructableSystem<T>, init?: SystemInit<T>): T {
    const scene = this.scene;
    if (!scene) {
      throw new Error(
        `[scenoco] ${this.constructor.name}.requireSystem(${type.name}) needs a scene. ` +
          'Call it from awake or later, not from a component on a detached object.',
      );
    }
    return scene.requireSystem(type, init);
  }

  // --- coroutines ----------------------------------------------------------------------

  /**
   * Run a generator across frames. `yield null` waits one frame, a bare number waits that many
   * seconds, and a promise is awaited.
   *
   * Every coroutine stops when the component is disabled or destroyed, so an endless loop is safe.
   */
  startCoroutine(body: Generator<Yieldable, unknown, unknown>): Coroutine {
    const coroutine = new Coroutine(body);
    (this._coroutines ??= []).push(coroutine);
    this._object3D?._runtime?.trackCoroutines(this);
    return coroutine;
  }

  /** Cancel a coroutine started by this component. */
  stopCoroutine(coroutine: Coroutine): void {
    coroutine.stop();
  }

  /** Cancel every coroutine started by this component. */
  stopAllCoroutines(): void {
    if (!this._coroutines) return;
    for (const coroutine of this._coroutines) coroutine.stop();
    this._coroutines.length = 0;
  }

  // --- events --------------------------------------------------------------------------

  /**
   * Subscribe to another object's {@link Event} for as long as this component lives — the
   * runtime unsubscribes during teardown, so a destroyed listener can never be called.
   */
  // `NoInfer` on the listener: the event's own type is the contract, so a listener that
  // ignores some arguments (the common case) can't narrow it.
  listen<TArgs extends unknown[]>(
    event: Event<TArgs>,
    listener: (...args: NoInfer<TArgs>) => void,
  ): void {
    event.on(listener);
    (this._subscriptions ??= []).push(() => event.off(listener));
  }

  /** @internal drop everything `listen` registered. Runs after `onDestroy`. */
  _unsubscribeAll(): void {
    if (!this._subscriptions) return;
    for (const unsubscribe of this._subscriptions) unsubscribe();
    this._subscriptions = null;
  }

  // --- cloning -------------------------------------------------------------------------

  /**
   * Copy another instance's settings onto this one — how components survive `Object3D.clone`.
   *
   * Every own field except the engine's internals, by the rules in {@link copyValue}: object
   * references stay references, disposable resources are shared, value objects and plain data are
   * duplicated. Anything left over is shared and warns. Override where that is wrong; a component
   * that *owns* a resource should build it in `awake`.
   */
  copy(source: this): this {
    for (const key of Object.keys(source)) {
      // `_`-prefixed fields are the runtime's bookkeeping; a fresh component starts clean.
      if (key.startsWith('_')) continue;
      const target = this as unknown as Record<string, unknown>;
      const value = (source as unknown as Record<string, unknown>)[key];
      target[key] = copyValue(value, source.constructor.name, key);
    }
    return this;
  }

  // --- destruction ---------------------------------------------------------------------

  /** Detach and destroy this component. `onDisable`/`onDestroy` run at the end of the frame. */
  destroy(): void {
    this._object3D?.removeComponent(this);
  }
}

/**
 * Declaration merge, not `implements`: subclasses get the typed optional hooks without the base
 * carrying empty bodies the engine would have to detect and skip.
 */
export interface Component extends ComponentLifecycle {}
