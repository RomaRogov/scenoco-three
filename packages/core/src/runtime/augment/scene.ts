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
     * Construct a system, apply `init` to it, and add it to this scene — `addComponent` one
     * level up, with `init` landing before `awake`.
     *
     * A scene holds **one system of each class**; adding a second is an error.
     */
    addSystem<T extends System>(type: ConstructableSystem<T>, init?: SystemInit<T>): T;
    /** Add an already-constructed system. It must not belong to another scene. */
    addSystem<T extends System>(instance: T): T;

    /** The system of this class on this scene, or `null`. */
    getSystem<T extends System>(type: SystemType<T>): T | null;

    /**
     * Get the system of this class, adding one if it is missing — the system-level
     * `requireComponent`, and how a service gets installed without anyone remembering to.
     * From a component, prefer its own `requireSystem`, which needs no scene in hand.
     */
    requireSystem<T extends System>(type: ConstructableSystem<T>, init?: SystemInit<T>): T;

    /** Remove a system, by instance or by class. Its `onDestroy` runs at the end of the frame. */
    removeSystem(target: System | SystemType): boolean;

    /** The camera `Engine` renders this scene with. Set it in `onLoad`. */
    mainCamera: Camera | null;

    /**
     * How this scene is drawn: tone mapping, shadows, post effects. `Engine` applies it while
     * this scene is active and restores the defaults for a scene that has none.
     */
    render: RenderSettings | null;

    /**
     * Keep this scene loaded when another is loaded — Unity's `DontDestroyOnLoad` for a whole
     * document. With `loadAdditive` being a no-op for a loaded scene, every level can ask for
     * the HUD and exactly one exists.
     */
    dontDestroyOnLoad: boolean;

    /**
     * Whether `unload` disposes the geometries, materials and textures it finds. On by default;
     * turn it off, or use `keepAlive`, for assets that outlive the scene.
     */
    disposeOnUnload: boolean;

    /** Exempt shared geometries, materials or textures from disposal on unload. */
    keepAlive(...assets: unknown[]): this;

    /**
     * Build the scene: `onLoad` is called and awaited, so async asset loading works. Components
     * added along the way get `awake` at once, `start` on the first tick. A no-op if loaded.
     */
    load(): Promise<this>;

    /**
     * Tear the scene down: `onUnload` runs first with the scene still intact, then every
     * component gets `onDisable` + `onDestroy`, every object leaves the graph, and GPU
     * resources are disposed unless `disposeOnUnload` is off.
     */
    unload(): Promise<this>;

    /**
     * First component of `type` anywhere in the scene — Unity's `FindObjectOfType<T>()`, which
     * likewise returns a component. To find an *object*, give it a marker component rather
     * than a string tag.
     */
    findObjectOfType<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T | null;
    /** Every component of `type` anywhere in the scene. Unity's `FindObjectsOfType<T>()`. */
    findObjectsOfType<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T[];

    /** Create a named empty object, add it, and return it — `new GameObject()`. */
    createObject(name?: string, parent?: Object3D): Object3D;

    /**
     * The node or component an id names, or `null` — how to reach *a specific thing*, where
     * `findObjectOfType` reaches *a kind of thing*.
     *
     * An id comes from a spawn (`instantiate(Slime, { id: 'slime3' })`) or from whatever built
     * the scene. Ids inside a spawned prefab are reached through it with `/`, as
     * `byId('slime3/body')`. Pass the class to get it typed, and `null` for a mismatch.
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

/**
 * A scene is the root of its own runtime and must have one before anything is added, so the
 * `_runtime` data property inherited from `Object3D` becomes a lazy accessor here.
 *
 * `configurable`, like every accessor below: evaluating this module twice — a dev server
 * re-serving it is enough — must replace the definition rather than throw at import time.
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
  // Before waking, so a system never sees defaults about to be replaced, as `addComponent` does.
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
  // Everything `onLoad` added is awake by now, so `onLoaded` can wire across the whole scene.
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

