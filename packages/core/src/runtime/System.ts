import type { Scene } from 'three';
import type { SystemLifecycle } from './types.js';

/**
 * A scene-level service that runs once per phase, after every component has had its turn.
 *
 * A component is behaviour attached to *one* node. A system is the thing that has no node:
 * a physics world, an audio bus, a batched renderer. Unity draws the same line — a
 * `MonoBehaviour` lives on a `GameObject`, while the physics step is a stage of the
 * `PlayerLoop` that runs after every `FixedUpdate` — and this is that stage, made
 * user-extensible.
 *
 * ```ts
 * export class Physics2D extends System {
 *   gravity = new Vector2(0, -9.81);
 *
 *   private world!: World;
 *   private readonly bodies: RigidBody2D[] = [];
 *
 *   override awake() { this.world = new World(this.gravity); }
 *
 *   override fixedUpdate(dt: number) {
 *     for (const body of this.bodies) body.writeToWorld();   // kinematic nodes → world
 *     this.world.step(dt);
 *     for (const body of this.bodies) body.readFromWorld();  // world → dynamic nodes
 *   }
 *
 *   override onDestroy() { this.world.free(); }
 *
 *   add(body: RigidBody2D) { this.bodies.push(body); }
 * }
 *
 * scene.addSystem(Physics2D, { gravity: new Vector2(0, 0) });
 * ```
 *
 * ### Where it runs
 *
 * Systems run **after** the matching component phase, which is the ordering physics needs:
 * every `fixedUpdate` that moves a body has already run when the world steps.
 *
 * ```text
 * once, on the first frame: component.start → system.start
 * per fixed step:   component.fixedUpdate → system.fixedUpdate → coroutines
 * per frame:        component.update      → system.update       → coroutines
 *                   component.lateUpdate  → system.lateUpdate
 *                   deferred destruction
 * ```
 *
 * `awake` runs while the scene is still being built — it is where a system builds *itself*.
 * `start` runs once the document is finished and every component has registered, which is where
 * a system may read the scene it serves, and where the node references a `<Systems>` entry
 * declared have been assigned.
 *
 * ### What a system deliberately is not
 *
 * It does **not** query the scene for the components it cares about. Components register
 * themselves — `this.requireSystem(Physics2D).add(this)` in a body's `awake` — which is one
 * line at the only place that already knows the relationship, and it means the runtime carries
 * no query machinery, no auto-start, and no rules about when a query is re-evaluated.
 *
 * A system also has no `enabled`. `Time.timeScale = 0` already stops fixed stepping, and a
 * system that wants a pause switch is free to declare one; a flag on the base class would need
 * `onEnable`/`onDisable` to mean anything, and neither has a job here.
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
   * Remove this system from its scene. `onDestroy` runs at the end of the current frame, never
   * in the middle of a phase — the same rule every destroy in SceNoCo follows.
   */
  destroy(): void {
    this._scene?.removeSystem(this);
  }
}

/**
 * Declaration merge, not `implements`: it gives every subclass the correctly-typed optional
 * hooks without forcing the base class to carry empty method bodies the runtime would then
 * have to detect and skip. Exactly how `Component` declares its hooks.
 */
export interface System extends SystemLifecycle {}
