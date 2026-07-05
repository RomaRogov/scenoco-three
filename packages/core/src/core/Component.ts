import type { Object3D } from 'three';
import type { Engine, PointerEventData } from './Engine.js';

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

  /** First component of the given type on the same node, or null (Unity/Cocos style). */
  getComponent<T extends Component>(type: abstract new () => T): T | null {
    for (const c of this.engine.getComponents(this.node)) {
      if (c instanceof type) return c;
    }
    return null;
  }

  /**
   * First component of the given type on this node or any descendant, or null
   * (Unity `GetComponentInChildren` — includes self). Depth-first.
   */
  getComponentInChildren<T extends Component>(type: abstract new () => T): T | null {
    let found: T | null = null;
    this.node.traverse((object) => {
      if (found) return;
      for (const c of this.engine.getComponents(object)) {
        if (c instanceof type) {
          found = c as T;
          return;
        }
      }
    });
    return found;
  }

  /**
   * Every component of the given type on this node and its descendants (Unity
   * `GetComponentsInChildren` — includes self). Returns `[]` when none.
   */
  getComponentsInChildren<T extends Component>(type: abstract new () => T): T[] {
    const out: T[] = [];
    this.node.traverse((object) => {
      for (const c of this.engine.getComponents(object)) if (c instanceof type) out.push(c as T);
    });
    return out;
  }

  /**
   * Destroy this component (Cocos style) — enqueued and torn down (onDisable/
   * onDestroy) at the end of the current tick, so destroying inside a hook can't
   * corrupt a loop that's mid-iteration. It's skipped by every phase from now on.
   */
  destroy(): void {
    this.engine.destroyComponent(this);
  }

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
  /** The pointer pressed over this object (or a descendant). */
  onPointerDown?(event: PointerEventData): void;
  /** The pointer was released — delivered to the object the press started on. */
  onPointerUp?(event: PointerEventData): void;
  /** A press + release on this same object (a click / tap). */
  onPointerClick?(event: PointerEventData): void;
  /** The pointer moved while held after pressing this object; `event.delta` is the px movement. */
  onDrag?(event: PointerEventData): void;
}
