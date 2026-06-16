import type { Object3D } from 'three';
import type { Engine } from './Engine.js';

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
 * `@property(SomeComponent)` holds a live instance of that component — not
 * through any global bus.
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

  /** Remove this component from the engine, running onDisable/onDestroy (Cocos style). */
  destroy(): void {
    this.engine.removeComponent(this);
  }

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
}
