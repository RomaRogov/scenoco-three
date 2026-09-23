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

/** What {@link copyValue} answers for a value that is not data: the copy keeps its own. */
const OWN = Symbol('own');

/**
 * The per-value rules behind {@link Component.copy}. Data is copied; a thing with an identity is
 * either a reference — shared, or pointed at its copy by `instantiate` — or it is the instance's
 * own, and the copy keeps what its own initializers built.
 */
function copyValue(value: unknown): unknown {
  if (typeof value === 'function') return OWN;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const entries = value.map(copyValue);
    return entries.includes(OWN) ? OWN : entries;
  }

  const candidate = value as { isObject3D?: boolean; dispose?: unknown; clone?: () => unknown };
  // A node, or a component on one: a reference to something in the scene.
  if (candidate.isObject3D === true || value instanceof Component) return value;
  // A geometry, a material, a texture — an asset, shared as a Unity asset is.
  if (typeof candidate.dispose === 'function') return value;
  // A Vector3, a Color, an Euler: a value, and the copy gets its own.
  if (typeof candidate.clone === 'function') return candidate.clone();
  // Plain data — a literal, a collection, a date, a buffer.
  if (isPlainData(value)) {
    try {
      return structuredClone(value);
    } catch {
      return OWN; // a function somewhere inside it
    }
  }
  // Anything else is an object with a life of its own — an `Event`, a class the component made.
  return OWN;
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

/**
 * Base class for all behaviour — Unity's `MonoBehaviour`.
 *
 * Extend it, declare the settings as public fields, implement the hooks you need, and attach it
 * with `object3D.addComponent(MyComponent)`.
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
  _isActive = false;
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
    // Read before the component was ever on a node: a field initializer or a constructor, which
    // run inside `addComponent` before the node is set. It used to surface as "Cannot read
    // properties of null (reading 'position')" out of the scene's load, naming nothing.
    if (!this._object3D && this._state === ComponentState.Created) {
      throw new Error(
        `[scenoco] ${this.constructor.name}.object3D was read before the component is on a node — in a ` +
          'field initializer or a constructor. There is no node until awake(): move that line into awake().',
      );
    }
    if (!this._object3D) this.gone('object3D');
    return this._object3D;
  }

  /**
   * Refuse to answer for a component that has been destroyed.
   *
   * Destruction nulls the node, so every passthrough below turned into "Cannot read properties
   * of null (reading 'getComponent')" — a stack inside core, naming neither the component nor
   * the fact that it is gone. The common cause is a callback that outlived what it belonged to,
   * and that is what the message has to say.
   */
  private gone(member: string): never {
    throw new Error(
      `[scenoco] ${this.constructor.name} has been destroyed, so it has no node: ${member} cannot ` +
        'be read. Something is still holding it — an event listener, a timer, a captured `this`. ' +
        'Unsubscribe in onDestroy, or check `isDestroyed` first.',
    );
  }

  /** The node, for the passthroughs — the same refusal as `object3D`, without the constructor case. */
  private get host(): TObject {
    if (!this._object3D) this.gone('its components');
    return this._object3D;
  }

  /**
   * The scene this component lives in — there from `awake` on, so it needs no null check.
   *
   * Read on a component whose node is in no scene, it throws and says so.
   */
  get scene(): Scene {
    const scene = this._object3D?.scene;
    if (!scene) {
      throw new Error(
        `[scenoco] ${this.constructor.name}.scene was read while its node is in no scene. A ` +
          'component has one from awake on; before that, or on a node never added, it has none.',
      );
    }
    return scene;
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
   * exactly when it receives ticks.
   *
   * Unity's `Behaviour.isActiveAndEnabled`.
   */
  get isActiveAndEnabled(): boolean {
    return this._isActive && !this._pendingDestroy;
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
    return this.host.getComponent(type);
  }

  /** Shorthand for `this.object3D.getComponents(type)`. */
  getComponents<T extends Component>(type: ComponentType<T>): T[] {
    return this.host.getComponents(type);
  }

  /** Shorthand for `this.object3D.getComponentInChildren(type, includeInactive)`. */
  getComponentInChildren<T extends Component>(
    type: ComponentType<T>,
    includeInactive?: boolean,
  ): T | null {
    return this.host.getComponentInChildren(type, includeInactive);
  }

  /** Shorthand for `this.object3D.getComponentsInChildren(type, includeInactive)`. */
  getComponentsInChildren<T extends Component>(
    type: ComponentType<T>,
    includeInactive?: boolean,
  ): T[] {
    return this.host.getComponentsInChildren(type, includeInactive);
  }

  /** Shorthand for `this.object3D.getComponentInParent(type, includeInactive)`. */
  getComponentInParent<T extends Component>(
    type: ComponentType<T>,
    includeInactive?: boolean,
  ): T | null {
    return this.host.getComponentInParent(type, includeInactive);
  }

  /** Shorthand for `this.object3D.getComponentsInParent(type, includeInactive)`. */
  getComponentsInParent<T extends Component>(
    type: ComponentType<T>,
    includeInactive?: boolean,
  ): T[] {
    return this.host.getComponentsInParent(type, includeInactive);
  }

  // --- systems -------------------------------------------------------------------------

  /** Shorthand for `this.scene.getSystem(type)`. Null when there is no such system, or no scene. */
  getSystem<T extends System>(type: SystemType<T>): T | null {
    return this._object3D?.scene?.getSystem(type) ?? null;
  }

  /**
   * The scene's system of this class, created on first ask — how a component reaches a scene-level
   * service.
   *
   * Usually `requireSystem(X).add(this)` in `awake`.
   *
   * Throws on a detached node, which has no scene to hold the system.
   */
  requireSystem<T extends System>(type: ConstructableSystem<T>, init?: SystemInit<T>): T {
    const scene = this._object3D?.scene;
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
   * Run a generator across frames.
   *
   * `yield null` waits one frame, a bare number waits that many seconds, and a promise is waited
   * on — `const data = yield fetch(url).then((r) => r.json())` resumes with what it resolved to,
   * and a rejection is thrown at that `yield`, where your own try/catch can take it.
   *
   * Every coroutine stops when the component is disabled or destroyed, so an endless loop is
   * safe — including one that disables its own component from inside the loop.
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
   * Subscribe to an {@link Event} for as long as this component lives; the listener is dropped at
   * teardown.
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
   * Every own field except the engine's internals, by the rules in {@link copyValue}: values and
   * plain data are duplicated, nodes, components and assets stay references, and whatever else
   * the source holds — an `Event`, a bound handler, an object it built — the copy keeps its own,
   * as its initializers made it. Override where that is wrong.
   */
  copy(source: this): this {
    const target = this as unknown as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      // `_`-prefixed fields are the runtime's bookkeeping; a fresh component starts clean.
      if (key.startsWith('_')) continue;
      const value = copyValue((source as unknown as Record<string, unknown>)[key]);
      if (value !== OWN) target[key] = value;
    }
    return this;
  }

  // --- destruction ---------------------------------------------------------------------

  /**
   * Detach and destroy **this component**. `onDisable`/`onDestroy` run at the end of the frame.
   *
   * Not the node it is on — the same as Unity, where `Destroy(this)` removes the script and
   * leaves the object standing. To take the whole thing out of the game, which is nearly always
   * what an enemy dying means, write `this.object3D.destroy()`.
   */
  destroy(): void {
    this._object3D?.removeComponent(this);
  }
}

/**
 * Declaration merge, not `implements`: subclasses get the typed optional hooks without the base
 * carrying empty bodies the engine would have to detect and skip.
 */
export interface Component extends ComponentLifecycle {}
