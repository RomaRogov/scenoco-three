import type { Object3D, Scene } from 'three';
import { Component, ComponentState } from './Component.js';
import { System } from './System.js';
import { SystemRegistry } from './SystemRegistry.js';
import { Time } from './Time.js';
import type { ComponentWith, LifecycleHook } from './types.js';

/** A bucket slot. Removal nulls a slot rather than splicing, so iteration stays stable. */
type Slot<T> = T | null;

type FixedUpdater = ComponentWith<'fixedUpdate'>;
type Updater = ComponentWith<'update'>;
type LateUpdater = ComponentWith<'lateUpdate'>;

/** Where a throw happened. Typed against the lifecycle interfaces, so renames stay honest. */
type FailurePoint = LifecycleHook | 'coroutine';

function report(component: Component, at: FailurePoint, error: unknown): void {
  const owner = component._object3D?.name || '(unnamed)';
  console.error(`[scenoco] ${component.constructor.name}.${at}() threw on "${owner}":`, error);
}


// Each hook is called directly by name rather than through a string index. It is repetitive,
// and that is the point: `component.awake()` is a real call site that "find all references"
// and every refactoring tool can see. A broken component must not take the frame down with
// it, which is the only reason these wrappers exist at all.

function callAwake(component: Component): void {
  if (!component.awake) return;
  try {
    component.awake();
  } catch (error) {
    report(component, 'awake', error);
  }
}

function callOnEnable(component: Component): void {
  if (!component.onEnable) return;
  try {
    component.onEnable();
  } catch (error) {
    report(component, 'onEnable', error);
  }
}

function callStart(component: Component): void {
  if (!component.start) return;
  try {
    component.start();
  } catch (error) {
    report(component, 'start', error);
  }
}

function callOnDisable(component: Component): void {
  if (!component.onDisable) return;
  try {
    component.onDisable();
  } catch (error) {
    report(component, 'onDisable', error);
  }
}

function callOnDestroy(component: Component): void {
  if (!component.onDestroy) return;
  try {
    component.onDestroy();
  } catch (error) {
    report(component, 'onDestroy', error);
  }
}

/**
 * Run a component's teardown immediately. `runtime` is null for components on objects that
 * never made it into a scene — they still get `onDestroy`, they just have no registry to leave.
 */
export function teardownComponent(component: Component, runtime: SceneRuntime | null): void {
  if (component._state === ComponentState.Destroyed) return;
  const object = component._object3D;
  component._pendingDestroy = true;

  component.stopAllCoroutines();
  if (component._active) {
    component._active = false;
    callOnDisable(component);
  }
  callOnDestroy(component);
  // Last, so a destroyed listener can never be called by an event it outlived: `onDestroy`
  // may still emit, and may still be listening to something it is about to stop caring about.
  component._unsubscribeAll();
  component._state = ComponentState.Destroyed;

  runtime?.forget(component);
  runtime?.forgetId(component);
  if (object?._components) {
    const index = object._components.indexOf(component);
    if (index !== -1) object._components.splice(index, 1);
  }
  component._object3D = null!;
}

/**
 * Destroy an object and its subtree immediately: components first, depth-first, then the
 * object leaves the scene graph. Works with or without a runtime.
 */
export function teardownObject(object: Object3D, runtime: SceneRuntime | null): void {
  if (object._destroyed) return;
  object._pendingDestroy = true;
  // Depth-first, so children tear down before their parents.
  for (const child of object.children.slice()) teardownObject(child, runtime);

  if (object._components) {
    for (const component of object._components.slice()) teardownComponent(component, runtime);
  }
  runtime?.forgetId(object);
  object._destroyed = true;
  object._runtime = null;
  object._activeInHierarchy = false;
  object.removeFromParent();
}

/**
 * Per-scene bookkeeping: owns the flat component registry and drives the event cycle.
 * One is created lazily for every `Scene` the first time it needs one.
 *
 * The registry is flat on purpose — walking the scene graph every frame to find behaviour is
 * what makes hand-rolled Three.js loops slow and hard to reason about. Objects join and leave
 * it through the patched `Object3D.add` / `remove`, so it stays in step with the graph.
 */
/** Which id a node or component was registered under, so teardown can forget it. */
const idOf = new WeakMap<object, string>();

/**
 * A field of `holder` that is a node or a component — the shape a document id takes once
 * named: `this.player`, `this.spin`, and inside a prefab instance `instance.body`.
 */
export function ownField(holder: object, key: string): Object3D | Component | null {
  const value = (holder as Record<string, unknown>)[key];
  if (value instanceof Component) return value;
  if (value && typeof value === 'object' && (value as Object3D).isObject3D) return value as Object3D;
  return null;
}

export class SceneRuntime {
  readonly scene: Scene;

  /** Every registered component, live or disabled. Holes are compacted at end of frame. */
  private readonly all: Slot<Component>[] = [];
  // Each bucket holds components already narrowed to "implements this hook", so the tick loop
  // can call the method with no assertion and no runtime check.
  private readonly fixedUpdaters: Slot<FixedUpdater>[] = [];
  private readonly updaters: Slot<Updater>[] = [];
  private readonly lateUpdaters: Slot<LateUpdater>[] = [];
  private readonly coroutineHosts: Slot<Component>[] = [];
  /** Membership mirror of `all`, so registration stays O(1) per component. */
  private readonly tracked = new Set<Component>();
  private readonly coroutineTracked = new Set<Component>();

  /** The scene's systems: what exists, when each runs, when it goes. */
  private readonly registry = new SystemRegistry();

  private readonly pendingStart: Component[] = [];
  private readonly destroyQueue: Component[] = [];
  private readonly objectDestroyQueue: Object3D[] = [];

  private dirty = false;
  /** While true, destruction runs immediately instead of waiting for the end of the frame. */
  private tearingDown = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Number of live components in this scene. Handy for a debug HUD or a leak check. */
  get componentCount(): number {
    return this.tracked.size;
  }

  // --- registration --------------------------------------------------------------------

  /**
   * Attach an object and its whole subtree to this runtime, then run whatever lifecycle
   * hooks the new state calls for. Invoked by the patched `Object3D.add`. Idempotent, so it
   * doubles as the "this subtree was reparented, recompute it" path.
   */
  registerSubtree(root: Object3D): void {
    const found: Component[] = [];
    root.traverse((object) => {
      object._runtime = this;
      object._activeInHierarchy = object._active && (object.parent?._activeInHierarchy ?? true);
      // A node that declares `onLoad` is a prefab, and a prefab that never went through
      // `instantiate` never built itself — an empty node that renders nothing, which is a
      // miserable thing to debug visually.
      if (object.onLoad && !object._built) {
        console.warn(
          `[scenoco] "${object.name || object.constructor.name}" declares onLoad() but was ` +
            'added without being built, so it is empty. Use parent.instantiate(ThePrefab) ' +
            'instead of new ThePrefab() + add().',
        );
      }
      const components = object._components;
      if (!components) return;
      for (const component of components) {
        this.track(component);
        found.push(component);
      }
    });
    // Hooks run only once the whole subtree is consistent, so `awake` can safely look up
    // siblings and children that arrived in the same `add()` call.
    for (const component of found) this.sync(component);
  }

  /** Detach an object and its subtree. Components are disabled but not destroyed. */
  unregisterSubtree(root: Object3D): void {
    const found: Component[] = [];
    root.traverse((object) => {
      if (object._runtime !== this) return;
      object._runtime = null;
      object._activeInHierarchy = false;
      if (object._components) found.push(...object._components);
    });
    for (const component of found) {
      this.sync(component);
      this.forget(component);
    }
  }

  // --- systems -------------------------------------------------------------------------
  //
  // Delegated to `SystemRegistry`. The runtime keeps the *ordering* — systems run after
  // components in every phase — and the registry keeps everything else.

  /** Every system on this scene, in the order they were added. */
  get systemList(): readonly System[] {
    return this.registry.list;
  }

  /** The system of this class, or null. */
  getSystem<T extends System>(type: abstract new (...args: never[]) => T): T | null {
    return this.registry.get(type);
  }

  /** Register a system and wake it. A scene holds at most one of each class. */
  addSystem(system: System): void {
    this.registry.add(system);
  }

  /** Queue a system for removal at the end of the frame. */
  removeSystem(system: System): boolean {
    if (!this.registry.remove(system)) return false;
    if (this.tearingDown) this.flushDestroyQueue();
    return true;
  }

  // --- components ----------------------------------------------------------------------

  /** Register a single component added to an already-registered object. */
  add(component: Component): void {
    this.track(component);
    this.sync(component);
  }

  /**
   * Queue a component for destruction at the end of the frame. It stops ticking straight
   * away — `_active` is left alone so `teardownComponent` still knows to fire `onDisable`.
   */
  remove(component: Component): void {
    if (component._state === ComponentState.Destroyed || component._pendingDestroy) return;
    component._pendingDestroy = true;
    this.forgetId(component);
    this.destroyQueue.push(component);
    if (this.tearingDown) this.flushDestroyQueue();
  }

  /** Queue an object and its subtree for destruction at the end of the frame. */
  removeObject(object: Object3D): void {
    if (object._destroyed || object._pendingDestroy) return;
    // Mark the whole subtree now, so nothing in it ticks again between here and teardown — and
    // give its ids back now too. Destruction is deferred, registration is not: a spawner that
    // destroys `gem1` and spawns the next `gem1` in the same call is the ordinary reset, and it
    // must not be told the id is taken by a thing that is already on its way out.
    object.traverse((node) => {
      node._pendingDestroy = true;
      this.forgetId(node);
      if (node._components) {
        for (const component of node._components) {
          component._pendingDestroy = true;
          this.forgetId(component);
        }
      }
    });
    this.objectDestroyQueue.push(object);
    if (this.tearingDown) this.flushDestroyQueue();
  }

  /**
   * Sort a component into the buckets for the hooks it implements. A component that only
   * defines `awake` joins no tick bucket at all and therefore costs nothing per frame.
   */
  private track(component: Component): void {
    if (this.tracked.has(component)) return;
    this.tracked.add(component);
    this.all.push(component);
    if (component.fixedUpdate) this.fixedUpdaters.push(component as FixedUpdater);
    if (component.update) this.updaters.push(component as Updater);
    if (component.lateUpdate) this.lateUpdaters.push(component as LateUpdater);
    if (component._coroutines?.length) this.trackCoroutines(component);
  }

  /** @internal drop a component from every bucket. Called by `teardownComponent`. */
  /**
   * What `instantiate(prefab, { id })` registered, by id. A document's own ids are not in here:
   * they are fields on the scene class, which `Scene.byId` reads first.
   */
  readonly ids = new Map<string, Object3D | Component>();

  /** @internal */
  registerId(id: string, thing: Object3D | Component): void {
    const taken = this.ids.get(thing instanceof Component ? id : id) ?? ownField(this.scene, id);
    if (taken && taken !== thing) {
      throw new Error(
        `[scenoco] id "${id}" is already taken in this scene. Every id is unique — give each ` +
          'instance its own, e.g. `instantiate(Slime, { id: `slime${n}` })`.',
      );
    }
    this.ids.set(id, thing);
    idOf.set(thing, id);
  }

  /** @internal drop whatever id `thing` was registered under; nothing if it had none. */
  forgetId(thing: object): void {
    const id = idOf.get(thing);
    if (id === undefined) return;
    if (this.ids.get(id) === thing) this.ids.delete(id);
    idOf.delete(thing);
  }

  forget(component: Component): void {
    if (!this.tracked.delete(component)) return;
    this.clearSlot(this.all, component);
    this.clearSlot(this.fixedUpdaters, component as FixedUpdater);
    this.clearSlot(this.updaters, component as Updater);
    this.clearSlot(this.lateUpdaters, component as LateUpdater);
    if (this.coroutineTracked.delete(component)) this.clearSlot(this.coroutineHosts, component);
  }

  private clearSlot<T>(list: Slot<T>[], value: T): void {
    const index = list.indexOf(value);
    if (index === -1) return;
    list[index] = null;
    this.dirty = true;
  }

  /** @internal called when a component starts its first coroutine. */
  trackCoroutines(component: Component): void {
    if (this.coroutineTracked.has(component)) return;
    this.coroutineTracked.add(component);
    this.coroutineHosts.push(component);
  }

  // --- state machine -------------------------------------------------------------------

  /**
   * Bring one component's lifecycle state in line with the world: fire `awake` the first time
   * its object is live, then `onEnable` / `onDisable` on every transition after that.
   *
   * This is the only place those three hooks can fire from.
   */
  sync(component: Component): void {
    if (component._state === ComponentState.Destroyed || component._pendingDestroy) return;

    const object = component._object3D;
    const live = object != null && object._runtime === this && object._activeInHierarchy;

    // `awake` fires as soon as the object is live, even for a disabled component.
    if (live && component._state === ComponentState.Created) {
      component._state = ComponentState.Awake;
      callAwake(component);
    }

    const shouldBeActive = live && component._enabled && component._state !== ComponentState.Created;
    if (shouldBeActive === component._active) return;
    component._active = shouldBeActive;

    if (shouldBeActive) {
      callOnEnable(component);
      if (component._state === ComponentState.Awake) this.pendingStart.push(component);
    } else {
      component.stopAllCoroutines();
      callOnDisable(component);
    }
  }

  /** Re-evaluate a component after its `enabled` flag changed. */
  refreshComponent(component: Component): void {
    this.sync(component);
  }

  /** Re-evaluate every component on an object after its active state changed. */
  refreshObject(object: Object3D): void {
    const components = object._components;
    if (!components || components.length === 0) return;
    // Copy: a hook may add or remove components on the same object.
    for (const component of components.slice()) this.sync(component);
  }

  // --- event cycle ---------------------------------------------------------------------

  /** Run `start` on everything that became active since the last flush. */
  flushStarts(): void {
    // A `start` may activate more components, so drain until the queue settles.
    let passes = 0;
    while (this.pendingStart.length > 0) {
      if (++passes > MAX_CASCADE) {
        console.warn(
          `[scenoco] start() cascaded more than ${MAX_CASCADE} levels deep in "${this.scene.name || 'scene'}"; ` +
            `${this.pendingStart.length} component(s) deferred to the next frame. ` +
            'Something is very likely spawning in a loop.',
        );
        return;
      }
      const batch = this.pendingStart.splice(0, this.pendingStart.length);
      for (const component of batch) {
        if (!component._active || component._pendingDestroy) continue;
        if (component._state !== ComponentState.Awake) continue;
        component._state = ComponentState.Started;
        callStart(component);
      }
    }
    this.registry.flushStarts();
  }

  /**
   * Run one fixed step. The accumulator lives in `SceneManager`, so every loaded scene takes
   * the same number of steps at the same points in the frame.
   */
  runFixedStep(): void {
    this.flushStarts();
    const dt = Time.fixedDeltaTime;
    const list = this.fixedUpdaters;
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const component = list[i];
      if (!component || !canTick(component)) continue;
      try {
        component.fixedUpdate(dt);
      } catch (error) {
        report(component, 'fixedUpdate', error);
      }
    }
    // Systems last: every `fixedUpdate` that moved a body has run, so the physics world sees
    // the frame's final intentions before it steps. This is Unity's ordering.
    this.registry.fixedUpdate(dt);
    this.tickCoroutines(true);
  }

  /** Run `update` on every active component, then advance coroutines. */
  runUpdates(): void {
    this.flushStarts();
    const dt = Time.deltaTime;
    const list = this.updaters;
    // The length is snapshotted: a component created during this pass is appended to the
    // bucket, and waiting until the next frame to tick it is the predictable choice.
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const component = list[i];
      if (!component || !canTick(component)) continue;
      try {
        component.update(dt);
      } catch (error) {
        report(component, 'update', error);
      }
    }
    this.registry.update(dt);
    this.tickCoroutines(false);
  }

  /** Run `lateUpdate` on every active component. */
  runLateUpdates(): void {
    const dt = Time.deltaTime;
    const list = this.lateUpdaters;
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const component = list[i];
      if (!component || !canTick(component)) continue;
      try {
        component.lateUpdate(dt);
      } catch (error) {
        report(component, 'lateUpdate', error);
      }
    }
    this.registry.lateUpdate(dt);
  }

  private tickCoroutines(fixedPhase: boolean): void {
    const count = this.coroutineHosts.length;
    for (let i = 0; i < count; i++) {
      const host = this.coroutineHosts[i];
      if (!host || !host._active || host._pendingDestroy) continue;
      const coroutines = host._coroutines;
      if (!coroutines || coroutines.length === 0) continue;
      for (let j = 0; j < coroutines.length; j++) {
        const coroutine = coroutines[j]!;
        try {
          coroutine.tick(fixedPhase);
        } catch (error) {
          report(host, 'coroutine', error);
          coroutine.done = true;
        }
      }
      for (let j = coroutines.length - 1; j >= 0; j--) {
        if (coroutines[j]!.done) coroutines.splice(j, 1);
      }
    }
  }

  /** Run the destructions queued during the frame, then compact the buckets. */
  endFrame(): void {
    this.flushDestroyQueue();
    if (this.dirty) this.compact();
  }

  private flushDestroyQueue(): void {
    let passes = 0;
    while (
      this.objectDestroyQueue.length > 0 ||
      this.destroyQueue.length > 0 ||
      this.registry.hasPendingDestroy
    ) {
      if (++passes > MAX_CASCADE) {
        console.warn(
          `[scenoco] destruction cascaded more than ${MAX_CASCADE} levels deep in ` +
            `"${this.scene.name || 'scene'}"; the remainder is deferred to the next frame.`,
        );
        return;
      }
      const objects = this.objectDestroyQueue.splice(0, this.objectDestroyQueue.length);
      for (const object of objects) this.destroyObjectNow(object);

      const components = this.destroyQueue.splice(0, this.destroyQueue.length);
      for (const component of components) this.destroyComponentNow(component);

      // Systems last in the pass: a component's `onDestroy` commonly unregisters itself from a
      // system, so the system has to still be there when it runs.
      this.registry.flushDestroyed();
    }
  }

  /** Run a component's teardown right now, skipping the end-of-frame queue. */
  destroyComponentNow(component: Component): void {
    teardownComponent(component, this);
  }

  /** Run an object's teardown right now: its subtree dies, then it leaves the graph. */
  destroyObjectNow(object: Object3D): void {
    teardownObject(object, this);
  }

  // --- scene teardown ------------------------------------------------------------------

  /** Destroy every component and object in the scene. Called by `Scene.unload`. */
  teardown(): void {
    this.tearingDown = true;
    for (const child of this.scene.children.slice()) this.destroyObjectNow(child);
    this.flushDestroyQueue();
    // Systems outlive every component.
    this.registry.teardown();
    // Anything a teardown hook created, plus components on detached objects we still hold.
    for (const slot of this.all.slice()) {
      if (slot) this.destroyComponentNow(slot);
    }
    this.all.length = 0;
    this.ids.clear();
    this.fixedUpdaters.length = 0;
    this.updaters.length = 0;
    this.lateUpdaters.length = 0;
    this.coroutineHosts.length = 0;
    this.tracked.clear();
    this.coroutineTracked.clear();
    this.pendingStart.length = 0;
    this.destroyQueue.length = 0;
    this.objectDestroyQueue.length = 0;
    this.dirty = false;
    this.tearingDown = false;
  }

  private compact(): void {
    compactList(this.all);
    compactList(this.fixedUpdaters);
    compactList(this.updaters);
    compactList(this.lateUpdaters);
    compactList(this.coroutineHosts);
    this.dirty = false;
  }
}

/**
 * How many times a `start` or a destruction may cascade within one frame before the runtime
 * gives up on the frame and warns. Bounds runaway spawn loops without hiding them.
 */
const MAX_CASCADE = 16;

/** A component ticks only once it is active, started, and not on its way out. */
function canTick(component: Component): boolean {
  return (
    component._active &&
    !component._pendingDestroy &&
    // `Started` gates every tick, not just `update`: without it a component created during
    // the update pass would receive `lateUpdate` before its own `start`.
    component._state === ComponentState.Started
  );
}

/** Drop one entry from a dense list. Systems are few, so a splice is the right shape. */
function removeFrom<T>(list: T[], value: T): void {
  const index = list.indexOf(value);
  if (index !== -1) list.splice(index, 1);
}

function compactList<T>(list: Slot<T>[]): void {
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const value = list[read];
    if (value) list[write++] = value;
  }
  list.length = write;
}
