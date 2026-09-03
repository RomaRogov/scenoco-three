import { Scene, Object3D, type Camera } from 'three';
import type { Component } from '../Component.js';
import { System } from '../System.js';
import { SceneRuntime, ownField } from '../SceneRuntime.js';
import { disposeSceneResources } from '../dispose.js';
import type { RenderSettings } from '../RenderSettings.js';
import type {
  ComponentType,
  ConstructableSystem,
  SceneLifecycle,
  SystemInit,
  SystemType,
} from '../types.js';

declare module 'three' {
  interface Scene extends SceneLifecycle {
    /** @internal the component registry and event pump backing this scene. */
    readonly _runtime: SceneRuntime;
    /** @internal */
    _loaded: boolean;
    /** @internal assets exempted from disposal on unload. */
    _kept: Set<unknown> | null;

    /** The registry and event pump for this scene. Mostly useful for debug tooling. */
    readonly runtime: SceneRuntime;
    /** True between a completed `load` and the start of `unload`. */
    readonly isLoaded: boolean;
    /** How many components this scene is currently ticking. */
    readonly componentCount: number;

    /** Read-only view of the systems on this scene, in the order they were added. */
    readonly systems: readonly System[];

    // --- systems --------------------------------------------------------------------------
    /**
     * Construct a system, apply `init` to it, and add it to this scene.
     *
     * ```ts
     * scene.addSystem(Physics2D, { gravity: new Vector2(0, 0) });
     * ```
     *
     * The same shape as `addComponent`, one level up: a component is behaviour on a node, a
     * system is behaviour on the scene. `init` is applied before `awake` runs, so a system
     * always wakes up configured.
     *
     * A scene holds **one system of each class**. Adding a second is an error rather than a
     * second physics world nobody meant to create.
     */
    addSystem<T extends System>(type: ConstructableSystem<T>, init?: SystemInit<T>): T;
    /** Add an already-constructed system. It must not belong to another scene. */
    addSystem<T extends System>(instance: T): T;

    /** The system of this class on this scene, or `null`. */
    getSystem<T extends System>(type: SystemType<T>): T | null;

    /**
     * Get the system of this class, creating and adding one if it is missing — the system-level
     * `requireComponent`.
     *
     * This is how a component reaches the service it needs without anyone having to remember to
     * install it first:
     *
     * ```ts
     * class RigidBody2D extends Component {
     *   override awake() { this.requireSystem(Physics2D).add(this); }
     * }
     * ```
     *
     * A component has `requireSystem` as a shorthand for this, which is the spelling to reach
     * for — it is the one that does not need a scene in hand.
     */
    requireSystem<T extends System>(type: ConstructableSystem<T>, init?: SystemInit<T>): T;

    /**
     * Remove a system, by instance or by class. Its `onDestroy` runs at the end of the frame,
     * like every other destroy here. Returns true if one was removed.
     */
    removeSystem(target: System | SystemType): boolean;

    /** The camera `Engine` renders this scene with. Set it in `onLoad`. */
    mainCamera: Camera | null;

    /**
     * How this scene is drawn: tone mapping, shadows, post effects.
     *
     * `Engine` applies it while this scene is active, and puts the renderer's defaults back for
     * a scene that has none, so one level's look cannot leak into the next.
     *
     * This, `camera`, `dontDestroyOnLoad` and `disposeOnUnload` are the four things the engine
     * adds to a `THREE.Scene`; everything else on it is three.js's own.
     */
    render: RenderSettings | null;

    /**
     * Keep this scene loaded when another is loaded — Unity's `DontDestroyOnLoad`, for a whole
     * document.
     *
     * `SceneManager.load` unloads every other scene; one with this set stays. Combined with
     * `loadAdditive` being a no-op for an already-loaded scene, that makes a persistent HUD or
     * audio rig one line in every level that wants it, with exactly one copy however many
     * times it is asked for.
     */
    dontDestroyOnLoad: boolean;

    /**
     * Whether `unload` disposes the geometries, materials and textures it finds in the scene.
     * On by default — switching scenes should not leak GPU memory. Turn it off, or register
     * shared assets with `keepAlive`, when assets outlive the scene that used them.
     */
    disposeOnUnload: boolean;

    /** Exempt shared geometries, materials or textures from disposal on unload. */
    keepAlive(...assets: unknown[]): this;

    /**
     * Build the scene. Calls your `onLoad` hook and awaits it, so async asset loading just
     * works. Components added along the way get `awake` immediately; `start` runs on the
     * first tick after loading. Calling `load` on an already-loaded scene is a no-op.
     */
    load(): Promise<this>;

    /**
     * Tear the scene down: `onUnload` runs first with the scene still intact, then every
     * component gets `onDisable` + `onDestroy`, every object leaves the graph, and GPU
     * resources are disposed unless `disposeOnUnload` is off.
     */
    unload(): Promise<this>;

    /**
     * First component of `type` anywhere in the scene, or `null`. Named after Unity's
     * `Object.FindObjectOfType<T>()`, which likewise returns a component, not an object.
     *
     * This is also how you find *objects*: give the ones you need to look up a marker
     * component (`class Player extends Component {}`) instead of a string tag, and the lookup
     * becomes a type-checked reference tooling can follow.
     */
    findObjectOfType<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T | null;
    /** Every component of `type` anywhere in the scene. Unity's `FindObjectsOfType<T>()`. */
    findObjectsOfType<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T[];

    /**
     * Create a named empty object, add it, and return it — Three.js's answer to `new GameObject()`.
     * Use it for the objects that exist only to carry components.
     */
    createObject(name?: string, parent?: Object3D): Object3D;

    /**
     * The node or component an id names, or `null`.
     *
     * An id is given at spawn time — `instantiate(Slime, { id: 'slime3' })` — or by whatever
     * built the scene. Ids inside a spawned prefab are reached through the instance, with `/`:
     * `byId('slime3/body')` is the node the slime prefab named `body`, and `byId('slime3/brain')`
     * the component it named `brain`.
     *
     * Pass the class to get it typed, and `null` when the id names something else:
     *
     * ```ts
     * const slime = this.scene.byId('slime3', Slime);          // Slime | null
     * const body = this.scene.byId('slime3/body', Mesh);       // Mesh | null
     * ```
     *
     * This is the way to reach *a specific thing*. `findObjectOfType` is for *a kind of thing*,
     * and holding a reference is better than either where you can.
     */
    byId(path: string): Object3D | Component | null;
    byId<T>(path: string, type: abstract new (...args: never[]) => T): T | null;
  }
}

const proto = Scene.prototype;
const runtimes = new WeakMap<Scene, SceneRuntime>();

proto._loaded = false;
proto._kept = null;
proto.mainCamera = null;
proto.disposeOnUnload = true;
proto.dontDestroyOnLoad = false;
proto.render = null;

// A scene is the root of its own runtime, so it must have one before anything is added to it.
// Overriding the `_runtime` data property from Object3D with an accessor keeps that lazy
// without having to patch the Scene constructor.
/**
 * Every accessor below is `configurable`, so evaluating this module twice replaces the previous
 * definition instead of throwing.
 *
 * A module that patches a shared prototype has to survive being evaluated more than once: a dev
 * server re-serving it after an unrelated file changed is enough, and the failure is brutal —
 * `Cannot redefine property: scene` is thrown at import time, so whatever was importing the
 * engine never finishes loading and you are left staring at an
 * empty viewport with no obvious cause.
 */
Object.defineProperty(proto, '_runtime', {
  get(this: Scene): SceneRuntime {
    let runtime = runtimes.get(this);
    if (!runtime) {
      runtime = new SceneRuntime(this);
      runtimes.set(this, runtime);
      // The scene root is always live; everything below inherits from it.
      this._activeInHierarchy = this._active;
    }
    return runtime;
  },
  set() {
    // A scene owns its runtime for life; `unregisterSubtree` trying to null it is ignored.
  },
  configurable: true,
});

Object.defineProperties(proto, {
  runtime: {
    get(this: Scene) {
      return this._runtime;
    },
    configurable: true,
  },
  isLoaded: {
    get(this: Scene) {
      return this._loaded;
    },
    configurable: true,
  },
  componentCount: {
    get(this: Scene) {
      return this._runtime.componentCount;
    },
    configurable: true,
  },
  systems: {
    get(this: Scene) {
      return this._runtime.systemList;
    },
    configurable: true,
  },
});

// --- systems ----------------------------------------------------------------------------

proto.addSystem = function (
  this: Scene,
  typeOrInstance: ConstructableSystem | System,
  init?: SystemInit<System>,
): System {
  const system = typeof typeOrInstance === 'function' ? new typeOrInstance() : typeOrInstance;

  if (!(system instanceof System)) {
    throw new TypeError('[scenoco] addSystem expects a System subclass or instance');
  }
  if (system._scene) {
    throw new Error(`[scenoco] ${system.constructor.name} already belongs to another scene`);
  }

  system._scene = this;
  // Configure before waking, so a system never wakes up looking at defaults it was about to
  // have overwritten — the same rule `addComponent` follows.
  if (init) Object.assign(system, init);
  this._runtime.addSystem(system);
  return system;
} as Scene['addSystem'];

proto.getSystem = function <T extends System>(this: Scene, type: SystemType<T>): T | null {
  return this._runtime.getSystem(type);
};

proto.requireSystem = function (
  this: Scene,
  type: ConstructableSystem,
  init?: SystemInit<System>,
): System {
  return this.getSystem(type) ?? this.addSystem(type, init);
} as Scene['requireSystem'];

proto.removeSystem = function (this: Scene, target: System | SystemType): boolean {
  const system = target instanceof System ? target : this.getSystem(target);
  return system ? this._runtime.removeSystem(system) : false;
};

proto.keepAlive = function (this: Scene, ...assets: unknown[]): Scene {
  const kept = (this._kept ??= new Set());
  for (const asset of assets) kept.add(asset);
  return this;
} as Scene['keepAlive'];

proto.load = async function (this: Scene): Promise<Scene> {
  if (this._loaded) return this;
  this._loaded = true;
  // Touch the runtime so the scene is live before `onLoad` starts adding objects.
  void this._runtime;
  this._activeInHierarchy = this._active;

  await this.onLoad?.();
  // Every object added by `onLoad` has been awoken by now, so `onLoaded` can safely wire
  // components across the whole scene.
  this.onLoaded?.();
  return this;
} as Scene['load'];

proto.unload = async function (this: Scene): Promise<Scene> {
  if (!this._loaded) return this;
  this._loaded = false;

  // The scene is still intact here — this is the place to read final state out of it.
  await this.onUnload?.();

  if (this.disposeOnUnload) disposeSceneResources(this, this._kept);
  this._runtime.teardown();
  this._kept = null;
  this.mainCamera = null;
  return this;
} as Scene['unload'];

// --- queries --------------------------------------------------------------------------

proto.findObjectOfType = function <T extends Component>(
  this: Scene,
  type: ComponentType<T>,
  includeInactive = false,
): T | null {
  return this.getComponentInChildren(type, includeInactive);
};

proto.findObjectsOfType = function <T extends Component>(
  this: Scene,
  type: ComponentType<T>,
  includeInactive = false,
): T[] {
  return this.getComponentsInChildren(type, includeInactive);
};

// --- spawning -------------------------------------------------------------------------

proto.byId = function (
  this: Scene,
  path: string,
  type?: abstract new (...args: never[]) => unknown,
): unknown {
  const [head = '', ...rest] = path.split('/');
  let current: Object3D | Component | null = this._runtime.ids.get(head) ?? ownField(this, head);
  for (const segment of rest) {
    if (!current) break;
    current = ownField(current, segment);
  }
  if (!current) return null;
  if (type && !(current instanceof type)) return null;
  return current;
} as Scene['byId'];

proto.createObject = function (this: Scene, name = 'Object', parent?: Object3D): Object3D {
  const object = new Object3D();
  object.name = name;
  (parent ?? this).add(object);
  return object;
};

