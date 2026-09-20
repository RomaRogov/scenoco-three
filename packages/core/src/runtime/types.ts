import type { Object3D, Scene, Vector3 } from 'three';
import type { Component } from './Component.js';
import type { System } from './System.js';

/** Any component class, abstract ones included — what `getComponent`/`findObjectsOfType` take. */
export type ComponentType<T extends Component = Component> = abstract new (...args: never[]) => T;

/** A constructable component class — what `addComponent` takes. Constructors take no arguments. */
export type ConstructableComponent<T extends Component = Component> = new () => T;

/**
 * The `Object3D` subclass a component declares it needs. `addComponent` uses it as its `this`
 * type, so attaching to the wrong kind of node is a type error rather than a crash in `awake`.
 */
export type OwnerOf<T extends Component> = T extends Component<infer TObject> ? TObject : Object3D;

/** True only when `X` and `Y` are identical, readonly modifiers included. */
type IsIdentical<X, Y, Then, Else> = (<G>() => G extends X ? 1 : 2) extends <G>() => G extends Y
  ? 1
  : 2
  ? Then
  : Else;

/**
 * True for a value, false for behaviour — both being functions is why this is not `extends
 * Function`: a class, such as the prefab a spawner repeats, is a value.
 */
type IsValue<V> = V extends Function
  ? V extends abstract new (...args: never[]) => unknown
    ? true
    : false
  : true;

/**
 * The keys of `T` holding plain assignable data: no methods, no `readonly` fields, and so no
 * getters — TypeScript models those as readonly, and assigning to one throws.
 */
type AuthorableKeys<T> = {
  [K in keyof T]-?: IsValue<T[K]> extends true
    ? IsIdentical<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }, K, never>
    : never;
}[keyof T];

/** The settable fields `T` declares beyond `TBase`, as an optional object. */
export type AuthorableFields<T, TBase> = Partial<
  Pick<Omit<T, keyof TBase>, AuthorableKeys<Omit<T, keyof TBase>>>
>;

/** The settings a component exposes: `addComponent(Bobber, { amplitude: 0.3 })`. */
export type ComponentInit<T extends Component> = AuthorableFields<T, Component>;

/**
 * Where an instantiated prefab goes. In the same call as its settings because a prefab's
 * `awake` runs with its transform already set — placing it afterwards is too late.
 */
export interface PrefabPlacement {
  /**
   * An id for this instance — `scene.byId('slime3')`, and `scene.byId('slime3/body')` for the
   * ids inside it. Unique within the scene; a duplicate throws.
   */
  id?: string;
  name?: string;
  position?: Vector3;
  /** Local rotation in **degrees**, matching `Object3D.eulerAngles`. */
  eulerAngles?: Vector3;
  /** A `Vector3`, or a number for uniform scale. */
  scale?: Vector3 | number;
  visible?: boolean;
  /**
   * `false` spawns it inactive: placed and in the scene, not woken until `setActive(true)` — the
   * same `active` a node takes in a document.
   */
  active?: boolean;
}

/**
 * A prefab class: any `Object3D` subclass that builds itself in `onLoad`.
 *
 * There is no `Prefab` base class and so no wrapper node — a prefab rooted at a mesh *is* a
 * `Mesh`, and a collider or a material sits exactly where you put it.
 */
export type PrefabType<T extends Object3D = Object3D> = new () => T;

/** Everything `instantiate` accepts: the prefab's own settings, plus where to put it. */
export type PrefabInit<T extends Object3D> = AuthorableFields<T, Object3D> & PrefabPlacement;

/** A system class — the key itself, so `scene.getSystem(Physics2D)` comes back typed. */
export type SystemType<T extends System = System> = abstract new (...args: never[]) => T;

/** A system class that can be constructed. System constructors never take arguments. */
export type ConstructableSystem<T extends System = System> = new () => T;

/** The settings a system exposes: `scene.addSystem(Physics2D, { gravity: new Vector2(0, 0) })`. */
export type SystemInit<T extends System> = AuthorableFields<T, System>;

/**
 * Every lifecycle hook a system may implement, all optional. Each means what it means on a
 * component, except that a system's runs after every component's.
 */
export interface SystemLifecycle {
  /**
   * Called once, when the system is added to a scene — before any component's `start`, so set the
   * state they read here. Build the world here too.
   */
  awake?(): void;
  /**
   * Called once, after every component in the scene has had `awake` and `start` — too late for
   * state they read in theirs. Where a system may read the scene: by now it is complete, where in
   * `awake` it is still being built.
   */
  start?(): void;
  /** Fixed-timestep tick, after every component's `fixedUpdate`. Step physics here. */
  fixedUpdate?(fixedDeltaTime: number): void;
  /** Per-frame tick, after every component's `update`. */
  update?(deltaTime: number): void;
  /** Per-frame tick, after every component's `lateUpdate`. */
  lateUpdate?(deltaTime: number): void;
  /**
   * Something outside the simulation moved the nodes this system mirrors — re-read them.
   * Unity's `Physics2D.SyncTransforms`: without it a teleported body is drawn in its new place
   * and collides in its old one.
   */
  syncTransforms?(): void;

  /**
   * Bring this system's *presentation* up to date on a frame that is not simulated — a UI
   * layout, which is arithmetic over the current state rather than a step of the world.
   *
   * Implement it only where running twice in a frame is harmless. Physics must not.
   */
  layout?(deltaTime: number): void;

  /** Called once when the system is removed or the scene unloads. Free the world here. */
  onDestroy?(): void;
}

/** The name of a system lifecycle hook, derived from the interface rather than restated. */
export type SystemHook = keyof SystemLifecycle;

/** A system narrowed to one that implements `K` — what the per-hook buckets hold. */
export type SystemWith<K extends SystemHook> = System & Required<Pick<SystemLifecycle, K>>;

/** A scene class. Scenes are identified by their class, never by a name string. */
export type SceneType<T extends Scene = Scene> = new () => T;

/** Every lifecycle hook a component may implement. All of them are optional. */
export interface ComponentLifecycle {
  /**
   * Called once, when the owning object first becomes part of a loaded scene and is active in
   * hierarchy — even if the component itself is disabled. Cache references here.
   */
  awake?(): void;
  /** Called every time the component transitions from inactive to active. */
  onEnable?(): void;
  /** Called once, right before the first `update`/`fixedUpdate` in which the component is active. */
  start?(): void;
  /** Fixed-timestep tick. Called 0..n times per frame. Use for physics and deterministic logic. */
  fixedUpdate?(fixedDeltaTime: number): void;
  /** Per-frame tick, scaled by `Time.timeScale`. */
  update?(deltaTime: number): void;
  /** Per-frame tick, after every `update` in the scene has run. Use for cameras and followers. */
  lateUpdate?(deltaTime: number): void;
  /** Called every time the component transitions from active to inactive. */
  onDisable?(): void;
  /**
   * Called once on destroy or unload — after `awake`, not necessarily after `start`. What `start`
   * builds may not exist yet.
   */
  onDestroy?(): void;
}

/** The name of a lifecycle hook, derived from the interface rather than restated. */
export type LifecycleHook = keyof ComponentLifecycle;

/**
 * A component narrowed to one that implements `K`. The per-hook buckets hold these, so the
 * runtime calls `component.update(dt)` with no `!` and no check at the call site.
 */
export type ComponentWith<K extends LifecycleHook> = Component &
  Required<Pick<ComponentLifecycle, K>>;

/**
 * Optional hooks a Scene subclass may implement, beyond the ones every node has. `onLoad` is
 * inherited rather than redeclared — one signature per property name across `Scene`'s bases.
 */
export interface SceneLifecycle extends NodeLifecycle {
  /** Called at the start of `unload`, while the scene is still intact. */
  onUnload?(): void | Promise<void>;
}

/**
 * The build hooks an `Object3D` subclass may implement to act as a prefab. Called only by
 * `instantiate`; a node added with plain `add()` is not built, and the runtime warns.
 */
export interface NodeLifecycle {
  /**
   * Populate this node. Called once by `instantiate`, after `init` is applied and before the
   * node enters the graph: its transform is final, and nothing below it has had `awake`.
   *
   * The promise is for `Scene.load()`, which awaits it. `instantiate` hands back a finished
   * node synchronously, so a prefab returning one is reported — load assets in the scene.
   */
  onLoad?(): void | Promise<void>;
  /** Called after the node is in the scene and every component below it has had `awake`. */
  onLoaded?(): void;
}
