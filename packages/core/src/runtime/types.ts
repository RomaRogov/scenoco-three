import type { Object3D, Scene, Vector3 } from 'three';
import type { Component } from './Component.js';
import type { System } from './System.js';

/**
 * Any component class, abstract ones included. This is what lookups take:
 * `getComponent(Health)`, `findObjectsOfType(Enemy)`.
 *
 * The Unity equivalent is a `System.Type` argument; here the class itself is the key, so
 * "find all references to `Health`" in your editor finds every lookup of it.
 */
export type ComponentType<T extends Component = Component> = abstract new (...args: never[]) => T;

/**
 * A component class that can actually be constructed. This is what `addComponent` takes.
 * Component constructors never take arguments — see {@link ComponentInit}.
 */
export type ConstructableComponent<T extends Component = Component> = new () => T;

/**
 * The `Object3D` subclass a component declares it needs — `PointLight` for
 * `class Flicker extends Component<PointLight>`, plain `Object3D` for `extends Component`.
 *
 * `addComponent` uses this as its `this` type, which is what makes attaching a component to
 * the wrong kind of object a compile error instead of a crash in `awake`.
 */
export type OwnerOf<T extends Component> = T extends Component<infer TObject> ? TObject : Object3D;

/** True only when `X` and `Y` are identical, readonly modifiers included. */
type IsIdentical<X, Y, Then, Else> = (<G>() => G extends X ? 1 : 2) extends <G>() => G extends Y
  ? 1
  : 2
  ? Then
  : Else;

/**
 * True for a value a document can name, false for behaviour it cannot.
 *
 * Both are functions, which is why this is not simply `extends Function`. A method or a
 * callback field is behaviour: there is no attribute that could fill it. A **class** is a
 * value — a prefab, a scene — and a field holding one is filled by a path, exactly as a
 * geometry or a material is. Excluding those was what stopped a component from being handed
 * the thing it repeats.
 */
type IsValue<V> = V extends Function
  ? V extends abstract new (...args: never[]) => unknown
    ? true
    : false
  : true;

/**
 * The keys of `T` that hold plain, assignable data: not methods, not `readonly` fields, not
 * getters without a setter.
 *
 * The `readonly` test is what also removes getters, since TypeScript models a getter with no
 * setter as a readonly property. Both matter: `Object.assign`-ing a getter-only property
 * throws at runtime, so letting one into the init type would be a compile-time green light
 * for a guaranteed crash.
 */
type AuthorableKeys<T> = {
  [K in keyof T]-?: IsValue<T[K]> extends true
    ? IsIdentical<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }, K, never>
    : never;
}[keyof T];

/**
 * The *authoring surface* of `T`: the settable fields it declares beyond `TBase`, as an
 * optional object. Everything inherited from the base, every method, every `readonly` field
 * and every getter is excluded.
 *
 * What is left is exactly the set of knobs the author meant to expose — which is also what a
 * scene DSL or a visual editor can offer as attributes, derived from the type rather than
 * from a hand-maintained schema.
 */
export type AuthorableFields<T, TBase> = Partial<
  Pick<Omit<T, keyof TBase>, AuthorableKeys<Omit<T, keyof TBase>>>
>;

/**
 * The settings a component exposes: `addComponent(Bobber, { amplitude: 0.3, frequency: 0.5 })`.
 */
export type ComponentInit<T extends Component> = AuthorableFields<T, Component>;

/**
 * Where an instantiated prefab goes. These are `Object3D` properties rather than prefab
 * settings, but they belong in the same call — a prefab's `awake` runs with its transform
 * already set, so placing it afterwards would be too late.
 */
export interface PrefabPlacement {
  name?: string;
  position?: Vector3;
  /**
   * Local rotation in **degrees**, matching `Object3D.eulerAngles`. Radians never appear in
   * authored data, so they never appear here either.
   */
  eulerAngles?: Vector3;
  /** A `Vector3`, or a number for uniform scale. */
  scale?: Vector3 | number;
  visible?: boolean;
}

/**
 * A prefab class: any `Object3D` subclass that builds itself in `onLoad`.
 *
 * There is no `Prefab` base class to extend, and therefore no wrapper node. A prefab whose
 * root is a mesh *is* a `Mesh`:
 *
 * ```ts
 * export class Brick extends Mesh {
 *   points = 10;
 *   onLoad() { this.geometry = brickGeometry; this.material = brickMaterial; }
 * }
 *
 * const brick = scene.instantiate(Brick, { position: somewhere });   // → Brick, a real Mesh
 * ```
 *
 * That is Unity's and Cocos's model: the prefab root is the authored node, so a collider, a
 * rigid body or a material sits exactly where the author put it, with no extra transform in
 * between.
 */
export type PrefabType<T extends Object3D = Object3D> = new () => T;

/**
 * Everything `instantiate` accepts: the prefab's own settings, plus where to put it.
 *
 * The two halves are flat on purpose — in a scene DSL they arrive as one attribute list
 * (`<Crate position="0 1 0" size="0.5" />`), so the API should not split them either.
 */
export type PrefabInit<T extends Object3D> = AuthorableFields<T, Object3D> & PrefabPlacement;

/**
 * A system class. Like a component class, this *is* the key — `scene.getSystem(Physics2D)`
 * comes back typed as `Physics2D`, and "find all references" finds every use of it.
 */
export type SystemType<T extends System = System> = abstract new (...args: never[]) => T;

/** A system class that can be constructed. System constructors never take arguments. */
export type ConstructableSystem<T extends System = System> = new () => T;

/**
 * The settings a system exposes: `scene.addSystem(Physics2D, { gravity: new Vector2(0, 0) })`.
 * Derived from the class the same way `ComponentInit` is, so the two read identically.
 */
export type SystemInit<T extends System> = AuthorableFields<T, System>;

/**
 * Every lifecycle hook a system may implement. All of them are optional, and every one of them
 * means on a system exactly what it means on a component — the only difference is that a
 * system's runs after every component's.
 */
export interface SystemLifecycle {
  /** Called once, when the system is added to a scene. Build the world here. */
  awake?(): void;
  /**
   * Called once, before the first `update` of the first frame this system is part of — after
   * every component in the scene has had `awake`, and after their `start`s.
   *
   * This is where a system reads the scene. `awake` runs while the scene is still being built,
   * so a system that counted the nodes it serves there would count whatever existed at the
   * moment it was added; by `start` the document is finished and every component has
   * registered itself. It is the same promise Unity's `Start` makes, one level up.
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
   *
   * A physics world holds its own copy of every body's position, and it is the copy that is
   * authoritative during a step. Write a node's `position` from anywhere else — an editor gizmo,
   * a script teleporting a character — and the two disagree: the object is drawn in its new
   * place and collides in its old one. Unity has the same seam and the same answer,
   * `Physics2D.SyncTransforms`.
   *
   * The editor calls this on every system when entering play mode, which is the moment a whole
   * session's worth of dragging has to become real.
   */
  syncTransforms?(): void;

  /**
   * Bring this system's *presentation* up to date on a frame that is not being simulated.
   *
   * Some systems compute what a thing looks like rather than what it does — a UI layout is the
   * clear case: it is arithmetic over the current state, not a step of the world. An editor
   * sitting in edit mode ticks nothing, so a system that only ever updates inside the
   * simulation goes stale there, and a HUD is invisible until you press Play.
   *
   * Implement it only where running twice in a frame would be harmless. Physics must not.
   */
  layout?(deltaTime: number): void;

  /** Called once when the system is removed or the scene unloads. Free the world here. */
  onDestroy?(): void;
}

/** The name of a system lifecycle hook, derived from the interface rather than restated. */
export type SystemHook = keyof SystemLifecycle;

/**
 * A system narrowed to one that definitely implements `K`. The runtime sorts systems into
 * per-hook buckets with this, exactly as it does components.
 */
export type SystemWith<K extends SystemHook> = System & Required<Pick<SystemLifecycle, K>>;

/**
 * A scene class. Scenes are identified by their class, never by a name string, so
 * `SceneManager.load(MainMenu)` is checked by the compiler and followed by AST tools.
 */
export type SceneType<T extends Scene = Scene> = new () => T;

/** Every lifecycle hook a component may implement. All of them are optional. */
export interface ComponentLifecycle {
  /**
   * Called once, the first time the owning object becomes part of a loaded scene and is
   * active in hierarchy. Runs even if the component itself is disabled.
   * Use it to cache references — never to depend on another component's `start`.
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
  /** Called once when the component or its object is destroyed, or the scene is unloaded. */
  onDestroy?(): void;
}

/**
 * The name of a lifecycle hook. Derived from the interface, so renaming a hook there is a
 * compile error at every place the engine refers to it rather than a silent behaviour change.
 */
export type LifecycleHook = keyof ComponentLifecycle;

/**
 * A component narrowed to one that definitely implements `K`.
 *
 * The runtime sorts components into per-hook buckets, and typing the buckets with this is
 * what lets it call `component.update(dt)` directly — no `!`, no string indexing, no
 * `typeof fn === 'function'` at the call site.
 */
export type ComponentWith<K extends LifecycleHook> = Component &
  Required<Pick<ComponentLifecycle, K>>;

/**
 * Optional hooks a Scene subclass may implement, beyond the ones every node has.
 *
 * `onLoad` is deliberately **not** redeclared here: a scene and a prefab answer the same
 * question with it — "populate yourself" — and TypeScript requires one signature for one
 * property name across `Scene`'s bases. The difference is what happens to the return value:
 * `Scene.load()` awaits it, so an async scene can load assets, while `instantiate` cannot and
 * warns instead.
 */
export interface SceneLifecycle extends NodeLifecycle {
  /** Called at the start of `unload`, while the scene is still intact. */
  onUnload?(): void | Promise<void>;
}

/**
 * The build hooks an `Object3D` subclass may implement to act as a prefab. Optional, and
 * only called by `instantiate` — a node added with plain `add()` is not built, which is what
 * the runtime warns about.
 */
export interface NodeLifecycle {
  /**
   * Populate this node. Called once by `instantiate`, after the placement and settings from
   * `init` have been applied and *before* the node enters the scene graph — so nothing below
   * it has had `awake` yet, and its transform already holds its final value.
   *
   * The return type admits a promise because `Scene` shares this hook and `Scene.load()`
   * awaits it. `instantiate` cannot: it has to hand back a finished node synchronously, so a
   * prefab that returns a promise is reported rather than silently entering the graph
   * half-built. Load assets in the scene, and hand them to the prefab.
   */
  onLoad?(): void | Promise<void>;
  /** Called after the node is in the scene and every component below it has had `awake`. */
  onLoaded?(): void;
}
