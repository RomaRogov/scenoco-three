import type { Scene } from 'three';
import type { SystemLifecycle } from './types.js';

/**
 * A scene-level service that runs once per phase, after every component has had its turn.
 *
 * A component is behaviour on *one* node. A system is the thing with no node: a physics world,
 * an audio bus, a batched renderer. Unity draws the same line — a `MonoBehaviour` lives on a
 * `GameObject`, while the physics step is a stage of the loop that runs after every
 * `FixedUpdate`.
 *
 * ```ts
 * export class Physics2D extends System {
 *   gravity = new Vector2(0, -9.81);
 *   private world!: World;
 *
 *   override awake() { this.world = new World(this.gravity); }
 *   override fixedUpdate(dt: number) { this.world.step(dt); }
 *   override onDestroy() { this.world.free(); }
 * }
 *
 * scene.addSystem(Physics2D, { gravity: new Vector2(0, 0) });
 * ```
 *
 * Each phase runs after the components' — every `fixedUpdate` that moved a body has run before
 * the world steps. `awake` builds the system itself, while the scene is still filling up;
 * `start` runs once every component has registered, and is where a system reads the scene.
 *
 * A system does not query the scene: components register themselves —
 * `this.requireSystem(Physics2D).add(this)` in a body's `awake` — which is one line at the only
 * place that already knows the relationship. There is no `enabled` either; `Time.timeScale = 0`
 * stops fixed stepping, and a system wanting its own switch can declare one.
 */
export abstract class System {
  /** @internal set by `Scene.addSystem` immediately after construction. */
  _scene: Scene = null!;
  /** @internal `awake` has run. */
  _awake = false;
  /** @internal `onDestroy` has run, or is queued to. */
  _pendingDestroy = false;
  /** @internal */
  _destroyed = false;

  /**
   * The scene this system serves. Valid from `awake` onwards — a system is constructed by
   * `addSystem`, so like a component it has no scene during construction.
   */
  get scene(): Scene {
    return this._scene;
  }

  /** True once `onDestroy` has run. Spelled the same as `Component.isDestroyed`. */
  get isDestroyed(): boolean {
    return this._destroyed;
  }

  /**
   * Remove this system from its scene. `onDestroy` runs at the end of the frame, never in the
   * middle of a phase — the rule every destroy here follows.
   */
  destroy(): void {
    this._scene?.removeSystem(this);
  }
}

/**
 * Declaration merge, not `implements`: every subclass gets the typed optional hooks without the
 * base class carrying empty method bodies the runtime would then have to detect and skip.
 */
export interface System extends SystemLifecycle {}
