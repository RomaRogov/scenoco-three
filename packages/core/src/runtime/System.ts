import type { Scene } from 'three';
import type { Event } from './Event.js';
import type { ConstructableSystem, SystemInit, SystemLifecycle, SystemType } from './types.js';

/**
 * A scene-level service that runs once per phase, after every component has had its turn — a
 * physics world, an audio bus, a batched renderer. The thing with no node.
 *
 * `awake` builds the system while the scene is still filling up; `start` runs once every
 * component has registered, and is where a system may read the scene.
 *
 * A system never queries the scene: components register themselves, as
 * `this.requireSystem(Physics2D).add(this)` in a body's `awake`.
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
  /** @internal what `listen` registered, dropped after `onDestroy`. */
  _subscriptions: (() => void)[] | null = null;

  /** The scene this system serves. Valid from `awake` onwards, not during construction. */
  get scene(): Scene {
    return this._scene;
  }

  /** Another system in this scene, or null — a system reaches one the way a component does. */
  getSystem<T extends System>(type: SystemType<T>): T | null {
    return this.scene?.getSystem(type) ?? null;
  }

  /** The same, creating it if this is the first to ask — `Scene.requireSystem`. */
  requireSystem<T extends System>(type: ConstructableSystem<T>, init?: SystemInit<T>): T {
    const scene = this.scene;
    if (!scene) {
      throw new Error(
        `[scenoco] ${this.constructor.name}.requireSystem(${type.name}) needs a scene. ` +
          'Call it from awake or later.',
      );
    }
    return scene.requireSystem(type, init);
  }

  /**
   * Subscribe to an {@link Event} for as long as this system lives — `Component.listen`, for the
   * service a game's components report to.
   */
  listen<TArgs extends unknown[]>(event: Event<TArgs>, listener: (...args: NoInfer<TArgs>) => void): void {
    event.on(listener);
    (this._subscriptions ??= []).push(() => event.off(listener));
  }

  /** True once `onDestroy` has run. Spelled the same as `Component.isDestroyed`. */
  get isDestroyed(): boolean {
    return this._destroyed;
  }

  /** Remove this system from its scene. `onDestroy` runs at the end of the frame. */
  destroy(): void {
    this._scene?.removeSystem(this);
  }
}

/**
 * Declaration merge, not `implements`: subclasses get the typed optional hooks without the base
 * carrying empty bodies the runtime would have to detect and skip.
 */
export interface System extends SystemLifecycle {}
