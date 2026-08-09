import type { Object3D } from 'three';
import type { Engine, PointerEventData } from './Engine.js';
import type { Event } from './Event.js';
// Side-effect: augments Object3D with the component API used by `this.node` below.
import './node-augment.js';

/**
 * Base class for all SceNoCo components (Cocos Creator / Unity MonoBehaviour style).
 *
 * Lifecycle, driven by the Engine:
 *   onLoad    — once, immediately when the component is attached
 *   onEnable  — when the component becomes enabled (incl. right after onLoad)
 *   start     — once, on the first update tick while enabled
 *   update    — every tick while enabled
 *   onDisable — when the component becomes disabled
 *   onDestroy — once, when the component is removed or the engine is disposed
 *
 * Components share data through typed references — a field declared with
 * `@property({ type: SomeComponent, description })` holds a live instance of that
 * component — not through any global bus.
 *
 * `TNode` types the host node. A component attached to a specific kind of node
 * declares it and gets typed access with no casts:
 *
 *   class CameraRig extends Component<PerspectiveCamera> {
 *     override start() { this.node.fov = 60; this.node.updateProjectionMatrix(); }
 *   }
 *
 * The default `Object3D` keeps every plain component source-compatible.
 */
export abstract class Component<TNode extends Object3D = Object3D> {
  /** Host node (typed by `TNode`). Assigned by the engine before onLoad. */
  node!: TNode;
  /** Owning engine. Assigned by the engine before onLoad. */
  engine!: Engine;
  /** Author-assigned scene id, if any (from `id="…"` in XML). Used by `engine.findComponent`. */
  id?: string;

  /** @internal set by the engine after onLoad has run */
  _loaded = false;
  /** @internal set by the engine when start has run */
  _started = false;
  /**
   * @internal set by the engine when this component is enqueued for destruction.
   * Deferred destruction (Unity-style): the component stays live until the engine
   * flushes at end of tick, but every phase loop skips it from the moment it's
   * marked, so a hook that destroys mid-tick can't act on a dead component.
   */
  _destroyed = false;

  private _enabled = true;

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return;
    this._enabled = value;
    if (this._loaded) {
      if (value) this.onEnable?.();
      else this.onDisable?.();
    }
  }

  // Component *querying* lives on the host node (the Object3D augmentation in
  // node-augment.ts), not here — a component finds its siblings with
  // `this.node.getComponent(T)`, its descendants with
  // `this.node.getComponentInChildren(T)`, etc. Keeping those off the component
  // keeps its surface to its own lifecycle; `destroy()` stays because a component
  // ending its own life *is* its responsibility.

  /**
   * Destroy this component (Cocos style) — enqueued and torn down (onDisable/
   * onDestroy) at the end of the current tick, so destroying inside a hook can't
   * corrupt a loop that's mid-iteration. It's skipped by every phase from now on.
   */
  destroy(): void {
    this.engine.destroyComponent(this);
  }

  /**
   * Subscribe to another object's {@link Event} for as long as this component
   * lives: the engine unsubscribes on destroy, so a destroyed listener can never
   * be called. `listener` must be a stable function (a bound arrow field, not an
   * inline closure) if you also intend to `off` it yourself.
   *
   * This is how a component reacts to something it does not own, without the two
   * classes importing each other — see {@link Event}.
   */
  // `NoInfer` on the listener: the event's own type is the contract, so a
  // listener that ignores some arguments (the common case) can't narrow it.
  listen<TArgs extends unknown[]>(event: Event<TArgs>, listener: (...args: NoInfer<TArgs>) => void): void {
    event.on(listener);
    (this._subscriptions ??= []).push(() => event.off(listener));
  }

  /**
   * @internal Unsubscribe everything `listen` registered. Run by the engine as
   * part of teardown, after onDestroy.
   */
  _unsubscribeAll(): void {
    if (!this._subscriptions) return;
    for (const unsubscribe of this._subscriptions) unsubscribe();
    this._subscriptions = undefined;
  }

  /** @internal `off` thunks for the events `listen` subscribed to. */
  private _subscriptions?: (() => void)[];

  /**
   * Receives the build-time `config` compiled from this component's `src=`
   * document — a package-owned format (e.g. a particle system's `.particle.xml`)
   * turned into a plain JSON blob by a registered src-compiler. Called once,
   * before onLoad, only when the component used `src=`. Components without a
   * src document never implement this.
   */
  applyConfig?(config: unknown): void;

  onLoad?(): void;
  onEnable?(): void;
  start?(): void;
  /** Variable-rate tick, once per frame (dt = real seconds since last frame). */
  update?(dt: number): void;
  /**
   * Fixed-rate tick, for physics and anything that needs a deterministic step.
   * Called zero or more times per frame at `engine.fixedTimeStep` before
   * `update`. Runs after each physics-subsystem fixed step (see EngineSystem).
   */
  fixedUpdate?(fixedDt: number): void;
  /** Runs after every component's `update` in the same frame (camera follow, etc.). */
  lateUpdate?(dt: number): void;
  onDisable?(): void;
  onDestroy?(): void;

  // Pointer events (Unity-style), dispatched by the engine via a raycast from the
  // pointer through the active camera, bubbling up the hit object's ancestors.
  // Every mouse button dispatches; `event.button` says which one, so a hook that
  // only wants left clicks checks `event.button === MouseButton.Left`.
  /** The pointer pressed over this object (or a descendant). */
  onPointerDown?(event: PointerEventData): void;
  /** The pointer was released — delivered to the object the press started on. */
  onPointerUp?(event: PointerEventData): void;
  /** A press + release on this same object (a click / tap). */
  onPointerClick?(event: PointerEventData): void;
  /** The pointer moved while held after pressing this object; `event.delta` is the px movement. */
  onDrag?(event: PointerEventData): void;
}
