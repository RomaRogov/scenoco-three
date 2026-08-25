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
function copyValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copyValue);

  const candidate = value as { isObject3D?: boolean; dispose?: unknown; clone?: () => unknown };
  // A reference to another object in the scene stays a reference.
  if (candidate.isObject3D === true) return value;
  // Anything disposable is a GPU resource: shared, never duplicated.
  if (typeof candidate.dispose === 'function') return value;
  // Value objects get duplicated so the copy owns its own.
  if (typeof candidate.clone === 'function') return candidate.clone();
  return value;
}

/**
 * Base class for all behaviour. Extend it, declare the settings you want as public fields,
 * implement the hooks you need, and attach it with `object3D.addComponent(MyComponent)`.
 *
 * ```ts
 * class Spinner extends Component {
 *   speed = 1;
 *   update(dt: number) { this.object3D.rotation.y += this.speed * dt; }
 * }
 *
 * cube.addComponent(Spinner, { speed: 2.5 });
 * ```
 *
 * ### Requiring a specific Three.js type
 *
 * The type parameter says what kind of `Object3D` this component expects underneath it.
 * `this.object3D` is then typed as that class, with no cast:
 *
 * ```ts
 * class Flicker extends Component<PointLight> {
 *   update() { this.object3D.intensity = Math.random(); }   // `intensity` is in scope
 * }
 *
 * light.addComponent(Flicker);   // fine
 * mesh.addComponent(Flicker);    // compile error: a Mesh is not a PointLight
 * ```
 *
 * Leave it off — plain `extends Component` — for behaviour that only needs a transform.
 *
 * Every hook is optional: the runtime only puts a component in a tick bucket if it actually
 * defines that hook, so an `awake`-only component costs nothing per frame.
 *
 * Constructors take no arguments — the engine constructs the component for you and applies
 * the `init` object before `awake`. Anything that needs the owning object goes in `awake`.
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
   * The `THREE.Object3D` this component is attached to, typed as whatever `TObject` says —
   * a `Mesh`, a `PointLight`, or plain `Object3D` when the component does not care.
   *
   * This is a real three.js object, not a wrapper: `position`, `rotation`, `scale`,
   * `lookAt`, `traverse`, `material` and everything else are exactly where they always were.
   * Only valid from `awake` onwards.
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
   * True when the component is enabled, its object is active in hierarchy, and it is in a
   * loaded scene — i.e. exactly when it receives ticks. Named after Unity's
   * `Behaviour.isActiveAndEnabled`, which means the same thing.
   */
  get isActiveAndEnabled(): boolean {
    return this._active && !this._pendingDestroy;
  }

  /**
   * True once `onDestroy` has run. Spelled the same as `Object3D.isDestroyed`.
   *
   * `isDestroyed` rather than `destroyed`, matching `isActiveAndEnabled` and `Scene.isLoaded`
   * — and leaving the plain word free, because `readonly destroyed = new Event<[Brick]>()` is
   * one of the most natural things a component ever declares.
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
   * Shorthand for `this.scene.requireSystem(type, init)`: get the scene's system of this class,
   * creating it if this is the first component to ask.
   *
   * This is how a component reaches a scene-level service, and it is the whole registration
   * story — there are no queries, because the component already knows what it needs:
   *
   * ```ts
   * class RigidBody2D extends Component {
   *   override awake() { this.requireSystem(Physics2D).add(this); }
   *   override onDestroy() { this.getSystem(Physics2D)?.remove(this); }
   * }
   * ```
   *
   * Throws on a component that is not in a scene: a scene-level service cannot be required
   * from a detached node, and handing back a system belonging to no scene would be worse.
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
   * Run a generator across frames.
   *
   * ```ts
   * start() { this.startCoroutine(this.patrol()); }
   *
   * private *patrol(): IEnumerator {
   *   while (true) {
   *     yield new WaitForSeconds(2);
   *     this.turn();
   *   }
   * }
   * ```
   *
   * `yield null` waits one frame, a bare number waits that many seconds, and a promise is
   * awaited. All of a component's coroutines stop when it is disabled or destroyed, so an
   * endless loop like the one above is safe.
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
   * Subscribe to another object's {@link Event} for as long as this component lives: the
   * runtime unsubscribes during teardown, so a destroyed listener can never be called.
   *
   * This is how a component reacts to something it does not own, without the two classes
   * importing each other. References point **down** (a field holding the thing you own);
   * events travel **up and out**.
   *
   * ```ts
   * start() { for (const brick of this.bricks) this.listen(brick.destroyed, this.onBrick); }
   * private onBrick = (brick: Brick) => { this.score += brick.points; };
   * ```
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
   * Copy another instance's settings onto this one. Called by `Object3D.copy` and therefore
   * by `Object3D.clone`, which is how components survive being cloned.
   *
   * The default copies every own field except the engine's internals, following three rules
   * for what to do with object values:
   *
   * - **References to other objects stay references.** A clone must not drag a duplicate of
   *   whatever it was pointing at into existence.
   * - **Disposable resources are shared**, never duplicated. Cloning a mesh should not double
   *   its GPU memory.
   * - **Value objects are duplicated** — `Vector3`, `Euler`, `Quaternion`, `Color` and
   *   anything else with a `clone()` — so the copy owns its own and the two cannot drift into
   *   each other.
   *
   * Override it when that is wrong for a particular component. A component that *owns* a
   * resource should create it in `awake` rather than in a field, so each instance gets its own
   * and there is nothing to copy.
   */
  copy(source: this): this {
    for (const key of Object.keys(source)) {
      // `_`-prefixed fields are the runtime's bookkeeping; a fresh component starts clean.
      if (key.startsWith('_')) continue;
      const target = this as unknown as Record<string, unknown>;
      target[key] = copyValue((source as unknown as Record<string, unknown>)[key]);
    }
    return this;
  }

  // --- destruction ---------------------------------------------------------------------

  /**
   * Detach and destroy this component. `onDisable` and `onDestroy` run at the end of the
   * current frame, never in the middle of an update pass.
   */
  destroy(): void {
    this._object3D?.removeComponent(this);
  }
}

/**
 * Declaration merge, not `implements`: it gives every subclass the correctly-typed optional
 * hooks without forcing the base class to carry empty method bodies the engine would then
 * have to detect and skip.
 */
export interface Component extends ComponentLifecycle {}
