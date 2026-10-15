import type { Object3D } from 'three';
import type { BehaviourHooks, BehaviourType } from './types.js';
import type { Event } from './Event.js';
import { Coroutine, type Yieldable } from './Coroutine.js';
import { cameraOf, type RenderCamera } from './camera.js';
import {
  runtimeOf,
  getComponent,
  getComponentInChildren,
  getComponentInParent,
  getComponents,
  getComponentsInChildren,
  refreshBehaviour,
} from './runtime.js';

/**
 * Base class for game behaviour — Unity's `MonoBehaviour`.
 *
 * Extend it, declare settings as public fields, implement the hooks you need. `N` is the node it
 * drives, and types `this.node`: `class Spinner extends Behaviour<Mesh>`. Constructors take no
 * arguments: settings arrive as fields.
 */
export abstract class Behaviour<N extends Object3D = Object3D> {
  /** @internal */ _node: N | null = null;
  /** @internal */ _enabled = true;
  /** @internal `awake` has run. */ _awoken = false;
  /** @internal `start` has run. */ _started = false;
  /** @internal queued by `destroy`, torn down at the end of the frame. */ _pendingDestroy = false;
  /** @internal */ _destroyed = false;
  /** @internal the runtime this behaviour is live in — receiving hooks — or null. */ _live: object | null = null;
  /** @internal */ _coroutines: Coroutine[] | null = null;
  /** @internal fields set from refs in JSX, re-read until `start`. */ _refs: Map<string, { current: unknown }> | null = null;
  /** @internal */ _subscriptions: (() => void)[] | null = null;

  /** The node this behaviour is attached to — a real renderer object, not a wrapper. */
  get node(): N {
    if (this._node) return this._node;
    throw new Error(
      this._destroyed
        ? `${this.constructor.name} has been destroyed, so it has no node. Something still holds it — ` +
            'an event listener, a timer, a captured `this`. Unsubscribe in onDestroy, or check isDestroyed.'
        : `${this.constructor.name}.node was read before the behaviour is on a node — in a field ` +
            'initializer or a constructor. Move that line into awake().',
    );
  }

  /** Whether this behaviour receives `update` and friends. Toggling fires `onEnable`/`onDisable`. */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (this._enabled === value || this._destroyed) return;
    this._enabled = value;
    refreshBehaviour(this);
  }

  /** Unity's `isActiveAndEnabled`: enabled, in a running scene, and not being destroyed — receiving hooks now. */
  get isActiveAndEnabled(): boolean {
    return this._live !== null && !this._pendingDestroy;
  }

  /** True once `onDestroy` has run. */
  get isDestroyed(): boolean {
    return this._destroyed;
  }

  // --- lookups on the same node, its children, its parents -----------------------------------

  getComponent<T extends Behaviour>(type: BehaviourType<T>): T | null {
    return getComponent(this.node, type);
  }

  getComponents<T extends Behaviour>(type: BehaviourType<T>): T[] {
    return getComponents(this.node, type);
  }

  getComponentInChildren<T extends Behaviour>(type: BehaviourType<T>): T | null {
    return getComponentInChildren(this.node, type);
  }

  getComponentsInChildren<T extends Behaviour>(type: BehaviourType<T>): T[] {
    return getComponentsInChildren(this.node, type);
  }

  getComponentInParent<T extends Behaviour>(type: BehaviourType<T>): T | null {
    return getComponentInParent(this.node, type);
  }

  /**
   * The camera the scene is drawn with — Unity's `Camera.main`. Move it, aim it, change its `fov`
   * and call `updateProjectionMatrix()`, as in three.js.
   */
  get camera(): RenderCamera {
    const camera = cameraOf(runtimeOf(this.node));
    if (!camera) throw new Error('`this.camera` is the camera the scene is drawn with: it exists once this behaviour is in a running scene.');
    return camera;
  }

  // --- events and coroutines -----------------------------------------------------------------

  /** Subscribe to an {@link Event} for as long as this behaviour lives. */
  listen<TArgs extends unknown[]>(event: Event<TArgs>, listener: (...args: NoInfer<TArgs>) => void): void {
    event.on(listener);
    (this._subscriptions ??= []).push(() => event.off(listener));
  }

  /**
   * Unity's `StartCoroutine`: run a generator method across frames — `yield null` waits a frame,
   * `yield new WaitForSeconds(1)` a second of game time, `yield new WaitUntil(() => …)` for a
   * condition. Stops when the behaviour is disabled or destroyed. `this.startCoroutine(this.wave())`.
   */
  startCoroutine(body: Generator<Yieldable, unknown, unknown>): Coroutine {
    const coroutine = new Coroutine(body);
    (this._coroutines ??= []).push(coroutine);
    return coroutine;
  }

  stopCoroutine(coroutine: Coroutine): void {
    coroutine.stop();
  }

  stopAllCoroutines(): void {
    for (const coroutine of this._coroutines ?? []) coroutine.stop();
    this._coroutines = null;
  }
}

/**
 * Declaration merge: subclasses get typed optional hooks without the base carrying empty bodies.
 * Merged with the class, so it repeats the class's type parameter.
 */
export interface Behaviour<N extends Object3D = Object3D> extends BehaviourHooks {}
