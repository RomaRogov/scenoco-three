import { AudioListener, type Camera, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer } from 'three';
import type { Intersection, Object3D, Vector3 } from 'three';
import type { Component } from './Component.js';
import { AssetCache } from './AssetCache.js';
import { InputManager } from './Input.js';
import { runsInEditor } from './decorators.js';
import { collectAssetRefs } from '../dsl/assets.js';
import { Registry } from './Registry.js';
import type { ComponentCtor } from './Registry.js';
import type { System } from './System.js';
import { bundleKind, type Bundle } from '../dsl/bundle-format.js';
import type { CompiledScene } from '../dsl/compiled.js';
import { deserializeBundle } from '../dsl/deserialize.js';
import { allSystemDefs, type AttachmentInstance } from '../dsl/nodes.js';
import { instantiateScene, type InstantiateContext, type InstantiatedScene } from '../dsl/instantiate.js';

/** A component constructor the engine can test instances against (for system queries). */
type ComponentType = abstract new (...args: never[]) => Component;

/**
 * Tooling map of a loaded scene: the compiled source it came from, the live
 * objects index-aligned with `compiled.nodes`, and reverse lookups from a live
 * `Object3D`/`Component` to its compiled index. Lets an editor resolve a picked
 * object back to the source node/component it must patch.
 */
export interface SceneGraph {
  compiled: CompiledScene;
  nodeByIndex: Object3D[];
  nodeIndexOf: Map<Object3D, number>;
  componentIndexOf: Map<Component, number>;
}

/**
 * An async hook the engine awaits before instantiating a scene/prefab. Asset
 * packages register one (via `engine.addPreloadProvider`) that scans the
 * compiled scene for the resources it owns and loads them into a shared cache,
 * so a component's `onLoad` never runs before its assets exist.
 */
export type PreloadProvider = (compiled: CompiledScene) => Promise<void>;

/** Options for {@link Engine.raycast}. */
export interface RaycastOptions {
  /** Normalized device coords `[-1..1]` to cast through. Default: `engine.input.mouseNdc`. */
  ndc?: Vector2;
  /** Objects to test. Default: the scene's children. */
  objects?: Object3D[];
  /** Recurse into descendants. Default: true. */
  recursive?: boolean;
}

/**
 * Payload for the pointer hooks a component may implement — `onPointerDown` /
 * `onPointerUp` / `onPointerClick` (Unity-style). Dispatched by raycasting from
 * the pointer through `mainCamera`, then bubbling up the hit object's ancestors.
 */
export interface PointerEventData {
  /** The hit object (for down/click) or the originally-pressed object (for up/drag). */
  object: Object3D;
  /** World-space point of the hit, when there is one (absent for drag). */
  point?: Vector3;
  /** Distance from the camera to the hit. */
  distance?: number;
  /** Mouse button (0 = left). */
  button: number;
  /** Pointer movement this frame, in pixels — set for `onDrag`. */
  delta?: Vector2;
}

/** The pointer hook names a component may implement (duck-typed). */
type PointerHook = 'onPointerDown' | 'onPointerUp' | 'onPointerClick' | 'onDrag';

export interface EngineOptions {
  /** Render target. Omit for headless use (tests, CLI tooling, validation). */
  canvas?: HTMLCanvasElement;
  /** Start the render loop immediately when a canvas is given. Default true. */
  autoStart?: boolean;
  /** Seconds per fixed step (physics + `fixedUpdate`). Default 1/60. */
  fixedTimeStep?: number;
  /**
   * Editor mode (Unity scene-view style): instantiate scenes but do **not** run
   * component hooks or systems — only components marked `@executeInEditor` run.
   * The scene shows its authored pose; no gameplay/physics. Default false.
   */
  editor?: boolean;
  /**
   * Keep the WebGL drawing buffer so `canvas.toDataURL()` can capture a frame
   * (the editor uses this for previews). Slight cost; default false.
   */
  preserveDrawingBuffer?: boolean;
  /**
   * Seed for the engine's deterministic RNG (`engine.random()`). Same seed +
   * same fixed-step input ⇒ identical runs (replays, tests, reproducible QA).
   * Omit for a time-seeded (non-deterministic) stream.
   */
  seed?: number;
}

/**
 * Core runtime: drives the component/system registry and the game loop. It does
 * not invent scene graph or camera objects — `loadScene` swaps in the Three.js
 * `Scene` the DSL compiled to (camera, fog, background and all), and the loop
 * renders that scene through whichever camera it found there.
 *
 * Without a canvas the engine runs headless — `tick(dt)` advances the
 * simulation manually, which is how tests and CLI tooling drive it.
 */
export class Engine {
  /**
   * The active Three.js scene. Defaults to an empty `Scene` so a bare engine can
   * be driven by hand; `loadScene` replaces it wholesale with the compiled scene.
   */
  scene: Scene = new Scene();
  readonly renderer?: WebGLRenderer;

  /**
   * The scene's camera (Unity `Camera.main`). `loadScene` sets it from the first
   * camera node it finds; the render loop draws through it, and components read it
   * for raycasting/projection. `undefined` when the scene has none — the loop then
   * skips rendering. Assign it directly to override (one camera, no priorities).
   */
  mainCamera?: Camera;

  /**
   * Unity-style input (keyboard/mouse/gamepad), sampled once per `tick`. Read it
   * from any component via `this.engine.input.getKeyDown('Space')`. Inert when the
   * engine runs headless (no DOM).
   */
  readonly input: InputManager;

  /** Editor mode — component hooks/systems are inert unless `@executeInEditor`. */
  readonly editorMode: boolean;

  /**
   * URL-keyed cache of loaded runtime assets (textures, glTF models), shared
   * across scene loads. A built-in preload provider fills it from a scene's
   * declared assets before `loadSceneAsync` instantiates; register a custom
   * loader with `engine.assets.registerLoader(...)`. Freed on `dispose`.
   */
  readonly assets = new AssetCache();

  /**
   * Time scale (Unity `Time.timeScale`): multiplies real frame time before it
   * drives the simulation. `1` normal, `0.5` slow-motion, `0` pauses gameplay
   * (fixed steps stop; `update` still runs with `deltaTime === 0`). Rendering
   * and input sampling are unaffected.
   */
  timeScale = 1;
  /** Scaled time elapsed since the engine started, in seconds (respects `timeScale`). */
  time = 0;
  /** Unscaled wall-clock time elapsed since the engine started, in seconds. */
  unscaledTime = 0;
  /** Scaled seconds for the current frame — the `dt` passed to `update`. */
  deltaTime = 0;
  /** Frames ticked since the engine started. */
  frameCount = 0;
  /**
   * Blend factor in `[0, 1)` for rendering between the previous and current
   * fixed step (`fixedAccumulator / fixedTimeStep`). Subsystems that move objects
   * at the fixed rate (physics) read it to interpolate poses and avoid jitter
   * when the render rate differs from the fixed rate.
   */
  interpolationAlpha = 0;

  /** Deterministic PRNG state (mulberry32); reseed via `reseed`. */
  private _seed: number;
  private rng: () => number;

  private readonly components: Component[] = [];
  /** Set when the component set changes, so the next tick re-sorts by execution order. */
  private componentsDirty = false;
  private readonly byNode = new Map<Object3D, Component[]>();
  private readonly byId = new Map<string, Component>();
  /** id → live Object3D, maintained on load/instantiate/destroy so findObject is O(1). */
  private readonly objectsById = new Map<string, Object3D>();
  /** Scene cameras, sorted by `priority` ascending — rendered in order (Unity camera depth). */
  cameras: Camera[] = [];
  private readonly systems: System[] = [];
  /** Each running system → the component type its `components` query is kept in sync with. */
  private readonly systemQueries = new Map<System, ComponentType>();
  private readonly rendererSize = new Vector2();
  /** Seconds per fixed step; accumulator carries leftover frame time. */
  private readonly fixedTimeStep: number;
  private fixedAccumulator = 0;
  private rafId?: number;
  private lastFrameTime?: number;
  /** Systems auto-run for the loaded scene — removed on unload. */
  private sceneSystems: System[] = [];
  /** True while `applyScene` registers the initial component batch; `runSceneSystems` attaches systems then (with the full set). */
  private applyingScene = false;
  /** Live attachment instances of the loaded scene (retained for findAttachment). */
  private sceneAttachments: AttachmentInstance[] = [];
  /** Tooling map of the loaded scene: live objects ⇄ their compiled-source indices. */
  private sceneGraph?: SceneGraph;
  /** Live spawned roots (from instantiate), so dispose() can tear down subtrees that live outside the scene root. */
  private readonly instances = new Set<Object3D>();
  /** Async asset hooks awaited by loadSceneAsync/instantiateAsync before instantiation. */
  private readonly preloadProviders: PreloadProvider[] = [];
  /**
   * Deferred destruction (Unity-style) — reused buffers of work enqueued by
   * `destroy`/`destroyComponent` during a tick and flushed once at end of tick.
   * Persistent so a frame of many despawns allocates nothing here.
   */
  private readonly pendingNodes: Object3D[] = [];
  private readonly pendingComponents: Component[] = [];
  private readonly raycaster = new Raycaster();
  /** The object a pointer press landed on, so the release/click can target it. */
  private pointerPressed?: Object3D;
  private _audioListener?: AudioListener;
  /** DOM UI overlay layered over the canvas; created on first `overlay` access. */
  private _overlay?: HTMLElement;

  constructor(options: EngineOptions = {}) {
    this.fixedTimeStep = options.fixedTimeStep ?? 1 / 60;
    this.editorMode = options.editor ?? false;
    this._seed = (options.seed ?? Math.floor(Math.random() * 0x1_0000_0000)) >>> 0;
    this.rng = mulberry32(this._seed);
    this.input = new InputManager({ ...(options.canvas ? { canvas: options.canvas } : {}) });
    // Built-in asset preloading: load every texture/model a scene declares into
    // the shared cache before instantiation (awaited only by the *Async loaders).
    this.addPreloadProvider((compiled) => this.assets.loadAll(collectAssetRefs(compiled).map((r) => r.url)));

    if (options.canvas) {
      this.renderer = new WebGLRenderer({
        canvas: options.canvas,
        antialias: true,
        preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      });
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
      if (options.autoStart !== false) this.start();
    }
  }

  /**
   * The DOM UI overlay — a `<div>` layered over the canvas for HTML/CSS UI (a
   * HUD, menus). Created on first access and positioned to cover the canvas. Its
   * root ignores pointer events so gameplay clicks still reach the canvas;
   * interactive widgets opt back in with `pointer-events:auto`.
   *
   * A component reaches it with plain DOM — `this.engine.overlay.querySelector(...)`,
   * `.textContent = ...`, `.addEventListener(...)` — no UI-specific API. A scene's
   * sibling `*.ui.html` is mounted here automatically on load; components just
   * drive the elements it declares.
   */
  get overlay(): HTMLElement {
    if (this._overlay) return this._overlay;
    const el = document.createElement('div');
    el.className = 'scenoco-ui';
    Object.assign(el.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
    // Sit inside the canvas's box: make the canvas's parent a positioning context
    // (only if it isn't one already) and overlay-fill it. Detached canvas (headless
    // tests) → the div stays unattached, which is harmless.
    const parent = this.renderer?.domElement.parentElement;
    if (parent) {
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      parent.appendChild(el);
    }
    this._overlay = el;
    return el;
  }

  /**
   * Attach a component to a node, by constructor or by registered name.
   * Runs onLoad (and onEnable if enabled); start runs on the next tick.
   */
  addComponent<T extends Component>(node: Object3D, type: new () => T, props?: Partial<T>): T;
  addComponent(node: Object3D, type: string, props?: Record<string, unknown>): Component;
  addComponent<T extends Component>(
    node: Object3D,
    type: (new () => T) | string,
    props?: Partial<T>,
  ): T {
    let ctor: ComponentCtor;
    if (typeof type === 'string') {
      const entry = Registry.getComponent(type);
      if (!entry) {
        const known = Registry.componentNames().join(', ') || '(none)';
        throw new Error(`Unknown component "${type}". Registered components: ${known}`);
      }
      ctor = entry.ctor;
    } else {
      ctor = type;
    }

    const instance = new ctor() as T;
    instance.node = node;
    if (props) Object.assign(instance, props);

    this.registerComponent(node, instance);
    this.initComponent(instance);
    return instance;
  }

  /** Bookkeeping only: track the instance without running any lifecycle hook. */
  private registerComponent(node: Object3D, instance: Component): void {
    instance.engine = this;
    this.components.push(instance);
    this.componentsDirty = true;
    let list = this.byNode.get(node);
    if (!list) this.byNode.set(node, (list = []));
    list.push(instance);
    // Index by id for findComponent. First registration wins on a duplicate
    // (dynamically spawned prefab instances may reuse internal ids).
    if (instance.id !== undefined && !this.byId.has(instance.id)) this.byId.set(instance.id, instance);
    // Keep each system's live query in sync.
    for (const [system, type] of this.systemQueries) {
      if (instance instanceof type) (system.components as Component[]).push(instance);
    }
    // A component appearing at RUNTIME (spawn / addComponent after load) must
    // start any `@system` that processes its type but isn't running yet —
    // otherwise a spawn-only scene (all bodies from prefabs, none at load) gets
    // silently dead physics. During the initial scene-load batch this is deferred
    // to runSceneSystems, which seeds each system with the full component set.
    if (!this.applyingScene) this.ensureSystemsFor(instance);
  }

  /** Start each scene-scoped `@system` that processes `instance`'s type and isn't already running. */
  private ensureSystemsFor(instance: Component): void {
    if (this.editorMode) return;
    for (const def of allSystemDefs()) {
      if (!(instance instanceof (def.componentType as ComponentType))) continue;
      if (this.systems.some((s) => s instanceof def.ctor)) continue;
      this.sceneSystems.push(this.addSystem(new def.ctor() as System));
    }
  }

  /** Run onLoad + onEnable for an already-registered instance (skipped in editor mode). */
  private initComponent(instance: Component): void {
    // Editor mode: leave non-@executeInEditor components inert (never loaded), so
    // the update/fixed/late loops — which gate on `_loaded` — also skip them.
    if (this.editorMode && !runsInEditor(instance)) return;
    instance.onLoad?.();
    instance._loaded = true;
    if (instance.enabled) instance.onEnable?.();
  }

  /** Detach a component, running onDisable (if enabled) and onDestroy. */
  removeComponent(instance: Component): void {
    const index = this.components.indexOf(instance);
    if (index === -1) return;
    this.components.splice(index, 1);
    this.componentsDirty = true;

    const list = this.byNode.get(instance.node);
    if (list) {
      const i = list.indexOf(instance);
      if (i !== -1) list.splice(i, 1);
      if (list.length === 0) this.byNode.delete(instance.node);
    }

    if (instance.id !== undefined && this.byId.get(instance.id) === instance) this.byId.delete(instance.id);
    // Drop it from any system query it belonged to.
    for (const [system, type] of this.systemQueries) {
      if (!(instance instanceof type)) continue;
      const q = system.components as Component[];
      const qi = q.indexOf(instance);
      if (qi !== -1) q.splice(qi, 1);
    }
    if (instance.enabled && instance._loaded) instance.onDisable?.();
    // Only tear down what was set up — an inert (never-loaded) editor component
    // never ran onLoad, so it gets no onDestroy.
    if (instance._loaded) instance.onDestroy?.();
  }

  getComponents(node: Object3D): readonly Component[] {
    return this.byNode.get(node) ?? [];
  }

  /**
   * Every live component assignable to `type`, across the whole engine (Unity
   * `FindObjectsByType`) — the type-only counterpart to `findComponent(id, Type)`,
   * which the id→instance map couldn't answer. Includes components on spawned
   * instances, not just the loaded scene; order is execution order. Returns `[]`
   * when none exist.
   */
  getComponentsOfType<T extends Component>(type: abstract new (...args: never[]) => T): T[] {
    const out: T[] = [];
    for (const c of this.components) if (!c._destroyed && c instanceof type) out.push(c as T);
    return out;
  }

  /**
   * Register an engine subsystem instance. Injects `system.engine`, seeds its
   * `components` query (from its `@system(Type)` registration), and runs
   * `onAttach`. Usually the engine does this for you (a registered `@system`
   * auto-runs when its component type appears); call it directly for manual use.
   */
  addSystem<T extends System>(system: T): T {
    system.engine = this;
    const type = allSystemDefs().find((d) => system instanceof d.ctor)?.componentType;
    if (type) {
      this.systemQueries.set(system, type as ComponentType);
      (system.components as Component[]).push(...this.components.filter((c) => c instanceof (type as ComponentType)));
    }
    this.systems.push(system);
    system.onAttach?.();
    return system;
  }

  /** The first running system assignable to `type` (Unity GetComponent style). */
  getSystem<T extends System>(type: abstract new (...args: never[]) => T): T | undefined {
    for (const s of this.systems) if (s instanceof type) return s as T;
    return undefined;
  }

  /** Remove a subsystem, running its `onDetach`. */
  removeSystem(system: System): void {
    const i = this.systems.indexOf(system);
    if (i === -1) return;
    this.systems.splice(i, 1);
    this.systemQueries.delete(system);
    system.onDetach?.();
  }

  /**
   * The live instance of an attachment type in the loaded scene (e.g. a system
   * reads `engine.findAttachment(Physics)?.gravity`). Singleton config attachments
   * are the typical use.
   */
  findAttachment<T extends AttachmentInstance>(type: abstract new (...args: never[]) => T): T | undefined {
    for (const a of this.sceneAttachments) if (a instanceof type) return a as T;
    return undefined;
  }

  /**
   * Find an Object3D by its scene `id` (e.g. `findObject('Turbine_01')`, or a
   * scoped prefab-instance internal `findObject('t1/blade')`). Searches the whole
   * loaded scene and any spawned instances; returns the first match.
   */
  findObject(id: string): Object3D | undefined {
    // Indexed lookup for scene/instance objects; fall back to a traversal for
    // anything added to the scene outside the engine's load/instantiate paths.
    return this.objectsById.get(id) ?? this.scene.getObjectByName(id);
  }

  /** Add or remove a subtree's named objects from the id index (first id wins). */
  private indexObjects(root: Object3D, add: boolean): void {
    root.traverse((object) => {
      if (!object.name) return;
      if (add) {
        if (!this.objectsById.has(object.name)) this.objectsById.set(object.name, object);
      } else if (this.objectsById.get(object.name) === object) {
        this.objectsById.delete(object.name);
      }
    });
  }

  /** A component's execution order (static stamped by `@component({ order })`); default 0. */
  private orderOf(component: Component): number {
    return (component.constructor as { executionOrder?: number }).executionOrder ?? 0;
  }

  /**
   * Cast a ray into the scene and return the hits (nearest first) — Unity
   * `Physics.Raycast` / Three.js `Raycaster`. Defaults to a ray from the pointer
   * (`input.mouseNdc`) through `mainCamera` against the whole scene, so
   * `engine.raycast()[0]?.object` is "what's under the cursor". Returns `[]` with
   * no active camera.
   */
  raycast(options: RaycastOptions = {}): Intersection[] {
    if (!this.mainCamera) return [];
    // Ensure world matrices are current — a raycast can run before the first
    // render (or headless), when they'd otherwise be stale.
    this.scene.updateMatrixWorld();
    this.mainCamera.updateMatrixWorld();
    this.raycaster.setFromCamera(options.ndc ?? this.input.mouseNdc, this.mainCamera);
    return this.raycaster.intersectObjects(options.objects ?? this.scene.children, options.recursive ?? true);
  }

  /**
   * Raycast from the pointer on press/release and deliver `onPointerDown` /
   * `onPointerUp` / `onPointerClick` to the hit object's components, bubbling up
   * its ancestors (Unity/DOM-style). `onPointerUp` goes to the originally-pressed
   * object; `onPointerClick` fires only when the release is over that same object.
   * Inert in editor mode / without a camera. Cheap: only raycasts on a click edge.
   */
  private dispatchPointerEvents(): void {
    if (this.editorMode || !this.mainCamera) return;
    const down = this.input.getMouseButtonDown(0);
    const up = this.input.getMouseButtonUp(0);

    // Drag: pointer held + moving after a press, delivered to the pressed object.
    // Delta-based — no raycast (the dragged object needn't stay under the cursor).
    if (!down && this.pointerPressed && this.input.getMouseButton(0)) {
      const delta = this.input.mouseDelta;
      if (delta.x !== 0 || delta.y !== 0) this.emitPointer('onDrag', this.pointerPressed, undefined, delta);
    }

    if (!down && !up) return;
    const hit = this.raycast()[0];
    if (down) {
      this.pointerPressed = hit?.object;
      if (hit) this.emitPointer('onPointerDown', hit.object, hit);
    }
    if (up) {
      const pressed = this.pointerPressed;
      this.pointerPressed = undefined;
      if (pressed) this.emitPointer('onPointerUp', pressed, hit);
      if (hit && hit.object === pressed) this.emitPointer('onPointerClick', hit.object, hit);
    }
  }

  /** Dispatch a pointer hook to a target's components, then bubble up to the scene root. */
  private emitPointer(hook: PointerHook, target: Object3D, hit: Intersection | undefined, delta?: Vector2): void {
    const event: PointerEventData = { object: target, point: hit?.point, distance: hit?.distance, button: 0 };
    if (delta) event.delta = delta.clone();
    for (let object: Object3D | null = target; object; object = object.parent) {
      for (const component of this.getComponents(object)) {
        if (component._destroyed) continue;
        const fn = (component as unknown as Record<string, unknown>)[hook];
        if (typeof fn === 'function') (fn as (e: PointerEventData) => void).call(component, event);
      }
      if (object === this.scene) break;
    }
  }

  /**
   * Tooling view of the loaded scene: the compiled (flat, indexed) source plus
   * maps from each live `Object3D`/`Component` to its compiled index — the bridge
   * editors need to write live edits back to the source. `undefined` until a
   * scene is loaded via `loadScene` (a prefab spawned by `instantiate` has none).
   */
  getSceneGraph(): SceneGraph | undefined {
    return this.sceneGraph;
  }

  /**
   * The Web Audio listener (the "ears"), parented to the active camera so
   * positional audio is heard from the camera's pose. Created **lazily** on first
   * access — a scene with no audio never opens an `AudioContext`. Returns
   * `undefined` headless (no Web Audio), so audio code stays no-op in tests/SSR.
   * Used by `@scenoco-three/audio`'s `Sound` component.
   */
  get audioListener(): AudioListener | undefined {
    if (typeof AudioContext === 'undefined') return undefined; // headless / no Web Audio
    if (!this._audioListener) this._audioListener = new AudioListener();
    const host = this.mainCamera ?? this.scene;
    if (this._audioListener.parent !== host) host.add(this._audioListener);
    return this._audioListener;
  }

  /** The current RNG seed (the value the stream was last (re)seeded with). */
  get seed(): number {
    return this._seed;
  }

  /** Restart the deterministic RNG from `seed` — for replays / reproducible runs. */
  reseed(seed: number): void {
    this._seed = seed >>> 0;
    this.rng = mulberry32(this._seed);
  }

  /**
   * Deterministic random in `[0, 1)` (Unity `Random.value`). Components should
   * use this instead of `Math.random()` so a run is reproducible from its seed.
   */
  random(): number {
    return this.rng();
  }

  /** Deterministic random float in `[min, max)`. */
  randomRange(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  /** Deterministic random integer in `[min, max)` (max exclusive). */
  randomInt(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min));
  }

  /**
   * Find a component by id — mirroring the `#id` references used in XML. Resolves
   * a component's own id first; failing that, treats `id` as a node id and returns
   * the (first) component on that node, optionally narrowed to `type`.
   *
   * `type` may be a class reference OR a registered component name string (e.g.
   * `'GameManager'`). The string form avoids the `import type` footgun: a type-only
   * import is erased at runtime, making the class reference undefined.
   */
  findComponent<T extends Component = Component>(
    id: string,
    type?: (abstract new () => T) | string,
  ): T | undefined {
    const ctor =
      typeof type === 'string'
        ? (Registry.getComponent(type)?.ctor as (abstract new () => T) | undefined)
        : type;
    const direct = this.byId.get(id);
    // Skip a component enqueued for destruction — to callers it's already gone.
    if (direct && !direct._destroyed && (!ctor || direct instanceof ctor)) return direct as T;
    // Fall back to the node with this id (indexed via findObject, so it also
    // resolves ids on spawned instances — not just a scene-root traversal).
    const node = this.findObject(id);
    if (node) {
      for (const c of this.getComponents(node)) if (!c._destroyed && (!ctor || c instanceof ctor)) return c as T;
    }
    return undefined;
  }

  /**
   * Register an async **preload provider** — a hook the engine awaits (in
   * `loadSceneAsync` / `instantiateAsync`) before instantiating a scene, so a
   * component's `onLoad` never runs before the assets it needs exist. Asset
   * packages (glTF/texture loaders) register one that scans the compiled scene
   * for the resources it owns and loads them into a shared cache. With none
   * registered, the async path is equivalent to the synchronous one.
   */
  addPreloadProvider(provider: PreloadProvider): void {
    this.preloadProviders.push(provider);
  }

  /** Remove a previously registered preload provider. */
  removePreloadProvider(provider: PreloadProvider): void {
    const i = this.preloadProviders.indexOf(provider);
    if (i !== -1) this.preloadProviders.splice(i, 1);
  }

  /**
   * Load a scene from a pre-built bundle (or a CompiledScene), replacing any
   * current one — **synchronously**. Bundles are produced at build time by
   * `scenoco/compiler`; the runtime never parses or validates XML. All components
   * are instantiated and their references wired before any onLoad runs, so
   * cross-component refs are valid from the first lifecycle hook.
   *
   * This does **not** await preload providers — any external assets a scene
   * references stream in afterward (the node updates when they arrive). Use
   * {@link loadSceneAsync} when a component's `onLoad` must see its assets ready.
   *
   * If the scene defines a camera, it becomes `mainCamera`; with none, `mainCamera`
   * stays undefined and the loop skips rendering until one is set.
   */
  loadScene(source: Bundle | CompiledScene): void {
    this.applyScene(this.toScene(source));
  }

  /**
   * Like {@link loadScene}, but first `await`s every registered preload provider
   * (asset loaders), so the scene is fully resourced before it is instantiated
   * and before any `onLoad` runs. The returned promise resolves once the scene is
   * live. With no providers registered it behaves like `loadScene` (resolving on
   * the next microtask).
   */
  async loadSceneAsync(source: Bundle | CompiledScene): Promise<void> {
    const compiled = this.toScene(source);
    await this.preload(compiled);
    this.applyScene(compiled);
  }

  /** Guard against a prefab bundle and deserialize a bundle to a CompiledScene. */
  private toScene(source: Bundle | CompiledScene): CompiledScene {
    if (Array.isArray(source) && bundleKind(source) === 'prefab') {
      throw new Error('loadScene() received a prefab bundle — use engine.instantiate() to spawn a prefab.');
    }
    return Array.isArray(source) ? deserializeBundle(source) : source;
  }

  /** Await all preload providers for a scene (asset loaders fill their caches here). */
  private async preload(compiled: CompiledScene): Promise<void> {
    if (this.preloadProviders.length > 0) {
      await Promise.all(this.preloadProviders.map((provider) => provider(compiled)));
    }
  }

  /** The synchronous core shared by `loadScene` and `loadSceneAsync`. */
  private applyScene(compiled: CompiledScene): void {
    // Full swap: tear the current scene down, then make the compiled Scene the
    // active one. The <Scene> node builds a real Three.js Scene, with fog/background
    // already applied and the camera living in it as a child node.
    this.disposeScene();
    const live = instantiateScene(compiled, this.instantiateContext());
    this.scene = live.root as Scene;
    this.sceneAttachments = live.attachments;
    this.indexObjects(this.scene, true);
    // Mount the scene's DOM UI overlay (its sibling *.ui.html) *before* onLoad,
    // so a component's onLoad can query its elements (engine.overlay). The static
    // HTML shows even in editor edit mode (components that drive it only run in
    // play mode); headless engines skip it (no document).
    if (compiled.ui && typeof document !== 'undefined') this.overlay.innerHTML = compiled.ui;
    // Defer system attach to runSceneSystems below, so each system starts once
    // with the full component set (not incrementally as the batch registers).
    // try/finally so a throwing onLoad can't wedge the flag on and disable
    // runtime system attach for the rest of the engine's life.
    this.applyingScene = true;
    try {
      this.initLive(live);
    } finally {
      this.applyingScene = false;
    }
    this.sceneGraph = buildSceneGraph(compiled, live);
    // Auto-run registered systems whose component type the scene contains — but
    // not in editor mode (no physics/batch processing on a static scene).
    this.sceneSystems = this.editorMode ? [] : this.runSceneSystems();

    // Cameras: render in `priority` order; the first found is the default main
    // camera (used for raycasting/pointer) unless overridden.
    this.cameras = collectCameras(this.scene);
    this.mainCamera = findCamera(this.scene);
  }

  /** Instantiate + run each registered @system whose component type is present. */
  private runSceneSystems(): System[] {
    const started: System[] = [];
    for (const def of allSystemDefs()) {
      const alreadyRunning = this.systems.some((s) => s instanceof def.ctor);
      const present = this.components.some((c) => c instanceof (def.componentType as ComponentType));
      if (alreadyRunning || !present) continue;
      started.push(this.addSystem(new def.ctor() as System));
    }
    return started;
  }

  /**
   * Spawn a prefab (or any bundle/CompiledScene) as a subtree under `parent`
   * (the scene root by default), at runtime — Unity/Cocos `Instantiate`.
   * Returns the root Object3D of the spawned subtree; pass it to `destroy()`
   * to remove just this subtree (the loaded scene and other instances are
   * untouched). References inside the prefab are already wired by index, so
   * spawning the same prefab many times is safe.
   */
  instantiate(source: Bundle | CompiledScene, parent: Object3D = this.scene): Object3D {
    const compiled = Array.isArray(source) ? deserializeBundle(source) : source;
    const live = instantiateScene(compiled, this.instantiateContext());
    parent.add(live.root);
    this.indexObjects(live.root, true);
    this.initLive(live);
    this.instances.add(live.root);
    return live.root;
  }

  /**
   * Like {@link instantiate}, but `await`s the preload providers first — so a
   * prefab whose assets aren't cached yet is fully resourced before its `onLoad`
   * runs. Prefer preloading a prefab's assets once at scene load; use this when a
   * prefab is spawned with assets that may not be ready.
   */
  async instantiateAsync(source: Bundle | CompiledScene, parent: Object3D = this.scene): Promise<Object3D> {
    const compiled = Array.isArray(source) ? deserializeBundle(source) : source;
    await this.preload(compiled);
    return this.instantiate(compiled, parent);
  }

  /**
   * Destroy an object and its whole subtree — Unity/Cocos `Destroy(gameObject)`.
   * **Deferred**: the object and its components are marked destroyed immediately
   * (so every phase this tick skips them) but the actual teardown — onDisable/
   * onDestroy, scene-graph detach, GPU free — runs when the engine flushes at end
   * of tick. Destroying inside a hook (a bullet despawning on hit) is therefore
   * safe: no system's live component array is spliced mid-step. Works on any
   * Object3D — an `instantiate`/`PrefabRef.spawn` root, a single node, or a
   * hand-built subtree. Calling it again is a harmless no-op.
   */
  destroy(object: Object3D): void {
    let alreadyQueued = true;
    object.traverse((node) => {
      for (const c of this.byNode.get(node) ?? []) {
        if (!c._destroyed) {
          c._destroyed = true;
          alreadyQueued = false;
        }
      }
    });
    // A subtree with no live components (or already fully marked) still needs its
    // node enqueued once so it's detached/freed — unless it's already pending.
    if (!alreadyQueued || !this.pendingNodes.includes(object)) this.pendingNodes.push(object);
  }

  /**
   * Destroy a single component (Cocos `Component.destroy`) — enqueued and torn
   * down at end of tick, like {@link destroy}. Marked destroyed at once so every
   * phase skips it from here on.
   */
  destroyComponent(instance: Component): void {
    if (instance._destroyed) return;
    instance._destroyed = true;
    this.pendingComponents.push(instance);
  }

  /**
   * Flush all destruction enqueued this tick: run the real teardown for each
   * pending node subtree (remove components → onDisable/onDestroy, drop from the
   * id index, detach, free GPU resources) and each pending lone component. Called
   * once per tick after systems step (before render), and defensively before any
   * scene swap/dispose so queued work never leaks across a load.
   */
  private flushDestroyed(): void {
    // Cursor-drain, not for-of: a component's onDestroy may itself destroy more
    // (a parent despawning its children), appending to these buffers as we go —
    // the cursors pick that up in the same flush without mutating a live loop.
    let ni = 0;
    let ci = 0;
    while (ni < this.pendingNodes.length || ci < this.pendingComponents.length) {
      while (ni < this.pendingNodes.length) {
        const object = this.pendingNodes[ni++]!;
        // Collect first: removeComponent mutates byNode as we go. Also forget any
        // spawned root inside this subtree so dispose() won't try to free it twice.
        const components: Component[] = [];
        object.traverse((node) => {
          const onNode = this.byNode.get(node);
          if (onNode) components.push(...onNode);
          this.instances.delete(node);
        });
        for (const c of components) this.removeComponent(c);
        this.indexObjects(object, false);
        object.removeFromParent();
        disposeObject(object);
      }
      // Lone components whose node wasn't itself destroyed (removeComponent is a
      // harmless no-op for any already torn down by a node flush above).
      while (ci < this.pendingComponents.length) this.removeComponent(this.pendingComponents[ci++]!);
    }
    this.pendingNodes.length = 0;
    this.pendingComponents.length = 0;
  }

  /**
   * Context for `instantiateScene`: how a `prefab` prop spawns — `engine.instantiate`,
   * so spawned subtrees are tracked and torn down by `dispose()`.
   */
  private instantiateContext(): InstantiateContext {
    return {
      spawn: (compiled, parent) => this.instantiate(compiled, parent),
      assets: this.assets,
    };
  }

  /** Register + run onLoad/onEnable for a freshly instantiated subtree. */
  private initLive(live: InstantiatedScene): Component[] {
    const components = live.components.map(({ instance }) => instance);
    for (const { instance, node } of live.components) this.registerComponent(node, instance);
    // onLoad in execution order (stable within equal orders).
    const ordered = [...live.components].sort((a, b) => this.orderOf(a.instance) - this.orderOf(b.instance));
    for (const { instance } of ordered) this.initComponent(instance);
    return components;
  }

  /**
   * Unload the active scene: destroy every component on it and free its GPU
   * resources, then leave a fresh empty `Scene` in place. Full swap — anything in
   * the previous scene goes with it (objects you want to keep live on a node that
   * isn't part of the scene, or in a spawned instance).
   */
  disposeScene(): void {
    // Flush any destruction still queued from the last tick before we swap, so a
    // pending subtree is torn down cleanly rather than stranded across the load.
    this.flushDestroyed();
    // Components first (a RigidBody.onDisable removes its body), then the
    // subsystems they used (PhysicsSystem.onDetach frees the world).
    const components: Component[] = [];
    this.scene.traverse((node) => {
      const onNode = this.byNode.get(node);
      if (onNode) components.push(...onNode);
      this.instances.delete(node);
    });
    for (const c of components) this.removeComponent(c);
    for (const s of this.sceneSystems) this.removeSystem(s);
    this.sceneSystems = [];
    this.sceneAttachments = [];
    this.sceneGraph = undefined;
    this.indexObjects(this.scene, false);
    disposeObject(this.scene);
    // Clear the DOM UI overlay; applyScene re-mounts the next scene's, if any.
    this._overlay?.replaceChildren();
    // Start fresh: an empty scene with no camera (rendering pauses until one loads).
    this.scene = new Scene();
    this.mainCamera = undefined;
    this.cameras = [];
  }

  /**
   * Advance the simulation by dt seconds, then render if a renderer exists.
   * Phases, in order: fixed steps (`fixedUpdate` + subsystem `fixedStep`,
   * repeated to drain the accumulator) → `start`/`update` → `lateUpdate` →
   * subsystem `step` → render. Variable `update` still runs exactly once per
   * tick, so existing components are unaffected.
   */
  tick(dt: number): void {
    // Sample input first so getKey/getKeyDown are consistent across every phase.
    this.input.beginFrame();

    // Scale real frame time into simulation time (timeScale: slow-mo / pause).
    // Input and rendering use real time; everything else uses the scaled dt.
    const scaled = dt * this.timeScale;
    this.deltaTime = scaled;
    this.time += scaled;
    this.unscaledTime += dt;
    this.frameCount++;

    // Re-sort components by execution order if the set changed (stable: equal
    // orders keep insertion order). Every phase below then runs in that order.
    if (this.componentsDirty) {
      this.components.sort((a, b) => this.orderOf(a) - this.orderOf(b));
      this.componentsDirty = false;
    }

    // Deliver pointer press/release/click to components before gameplay runs.
    this.dispatchPointerEvents();

    // Fixed-timestep phase (deterministic; physics + fixedUpdate). The substep
    // cap prevents a "spiral of death" after a long pause.
    this.fixedAccumulator += scaled;
    let steps = 0;
    while (this.fixedAccumulator >= this.fixedTimeStep && steps < MAX_FIXED_SUBSTEPS) {
      this.fixedStep(this.fixedTimeStep);
      this.fixedAccumulator -= this.fixedTimeStep;
      steps++;
    }
    if (steps === MAX_FIXED_SUBSTEPS) this.fixedAccumulator = 0; // drop the backlog
    // Fraction into the next fixed step — physics subsystems lerp poses by this.
    this.interpolationAlpha = this.fixedTimeStep > 0 ? this.fixedAccumulator / this.fixedTimeStep : 0;

    // Variable-rate phase: start (once) then update.
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i]!;
      if (!c.enabled || !c._loaded || c._destroyed) continue;
      if (!c._started) {
        c._started = true;
        c.start?.();
      }
      c.update?.(scaled);
    }
    // Late phase: after every update this frame.
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i]!;
      if (c.enabled && c._loaded && !c._destroyed) c.lateUpdate?.(scaled);
    }
    if (!this.editorMode) for (const s of this.systems) s.step?.(scaled);

    // Flush deferred destruction now — after all gameplay/systems ran, before
    // render — so a destroyed object neither draws a final frame nor lingers into
    // the next tick, and no phase above ever saw a spliced component array.
    this.flushDestroyed();

    // Render only when there's both a target and at least one camera — the engine
    // never supplies a fallback camera, so a scene without one simply doesn't draw.
    if (this.renderer && (this.cameras.length > 0 || this.mainCamera)) {
      this.resizeToCanvas();
      this.renderCameras();
    }
  }

  /**
   * The cameras to render this frame, in order. Normally the scene's cameras by
   * `priority` (Unity camera depth). But an explicitly-assigned `mainCamera` that
   * is **not** one of the scene's cameras is treated as a render **override** —
   * the engine draws through it alone (e.g. an editor's free-look camera, or any
   * external camera you point `mainCamera` at). With none, renders nothing.
   */
  private renderList(): Camera[] {
    if (this.mainCamera && !this.cameras.includes(this.mainCamera)) return [this.mainCamera];
    if (this.cameras.length > 0) return this.cameras;
    return this.mainCamera ? [this.mainCamera] : [];
  }

  /**
   * Render the scene through each camera in `priority` order (Unity camera depth),
   * one after another. A single camera renders normally; multiple cameras
   * composite — the first clears + draws the background, later cameras clear only
   * depth and draw on top (overlay/UI). Assign each camera's priority via the
   * `<PerspectiveCamera priority>` / `<OrthographicCamera priority>` attr.
   */
  private renderCameras(): void {
    const renderer = this.renderer!;
    const list = this.renderList();
    if (list.length === 0) return;
    if (list.length === 1) {
      renderer.render(this.scene, list[0]!);
      return;
    }
    const background = this.scene.background;
    renderer.autoClear = false;
    renderer.clear();
    list.forEach((camera, i) => {
      if (i > 0) {
        this.scene.background = null; // only the first camera paints the background
        renderer.clearDepth();
      }
      renderer.render(this.scene, camera);
    });
    this.scene.background = background;
    renderer.autoClear = true;
  }

  /** One fixed step: components' fixedUpdate (apply forces/read), then subsystems step. */
  private fixedStep(fixedDt: number): void {
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i]!;
      if (c.enabled && c._loaded && !c._destroyed) c.fixedUpdate?.(fixedDt);
    }
    if (!this.editorMode) for (const s of this.systems) s.fixedStep?.(fixedDt);
  }

  /** Start the requestAnimationFrame loop (no-op when already running or headless). */
  start(): void {
    if (this.rafId !== undefined || !this.renderer) return;
    this.lastFrameTime = undefined;
    const loop = (time: number) => {
      this.rafId = requestAnimationFrame(loop);
      const dt = this.lastFrameTime === undefined ? 0 : (time - this.lastFrameTime) / 1000;
      this.lastFrameTime = time;
      // Clamp dt so background-tab pauses don't produce giant simulation steps.
      this.tick(Math.min(dt, 0.1));
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
  }

  /** Stop the loop, destroy all components/instances/subsystems, free GPU resources. */
  dispose(): void {
    this.stop();
    for (const root of [...this.instances]) this.destroy(root);
    this.disposeScene();
    for (const c of [...this.components]) this.removeComponent(c);
    for (const s of [...this.systems]) this.removeSystem(s);
    this.input.dispose();
    this.assets.dispose();
    this.renderer?.dispose();
    this._overlay?.remove();
    this._overlay = undefined;
  }

  private resizeToCanvas(): void {
    const renderer = this.renderer!;
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.getSize(this.rendererSize);
    if (this.rendererSize.x !== width || this.rendererSize.y !== height) {
      renderer.setSize(width, height, false);
      // Keep every perspective camera's aspect current.
      for (const camera of this.renderList()) {
        if (camera instanceof PerspectiveCamera) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        }
      }
    }
  }
}

/** Build the tooling map linking live objects/components back to compiled indices. */
function buildSceneGraph(compiled: CompiledScene, live: InstantiatedScene): SceneGraph {
  const nodeIndexOf = new Map<Object3D, number>();
  live.nodes.forEach((object, i) => nodeIndexOf.set(object, i));
  const componentIndexOf = new Map<Component, number>();
  live.components.forEach(({ instance }, i) => componentIndexOf.set(instance, i));
  return { compiled, nodeByIndex: live.nodes, nodeIndexOf, componentIndexOf };
}

/** Max fixed substeps per frame — caps catch-up work after a long pause. */
const MAX_FIXED_SUBSTEPS = 5;

/** Depth-first search for the first camera in a subtree (Object3D.isCamera). */
function findCamera(root: Object3D): Camera | undefined {
  let found: Camera | undefined;
  root.traverse((o) => {
    if (!found && (o as Object3D & { isCamera?: boolean }).isCamera) found = o as unknown as Camera;
  });
  return found;
}

/** Every camera in a subtree, sorted by `userData.priority` ascending (render order). */
function collectCameras(root: Object3D): Camera[] {
  const cameras: Camera[] = [];
  root.traverse((o) => {
    if ((o as Object3D & { isCamera?: boolean }).isCamera) cameras.push(o as unknown as Camera);
  });
  cameras.sort((a, b) => priorityOf(a) - priorityOf(b));
  return cameras;
}

function priorityOf(camera: Camera): number {
  return (camera.userData.priority as number | undefined) ?? 0;
}

/**
 * Release geometries, materials, and their textures for every mesh in a subtree.
 * **Skips cache-managed resources** (`AssetCache`-owned textures, and the
 * geometry/materials a glTF clone shares with its cached original) — those
 * outlive any one scene and are freed by `engine.assets.dispose()`.
 */
function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Object3D & {
      geometry?: { dispose(): void; userData?: Record<string, unknown> };
      material?: unknown;
    };
    if (mesh.geometry && !AssetCache.isManaged(mesh.geometry)) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) disposeMaterial(m);
    else if (material) disposeMaterial(material);
  });
}

/**
 * Dispose a material **and the textures it holds** — `Material.dispose()` does
 * not free its texture maps, so without this every scene reload leaks GPU
 * texture memory. Covers both map-style fields (`map`, `normalMap`, …) and the
 * textures a `ShaderMaterial` carries in its `uniforms`.
 */
function disposeMaterial(material: unknown): void {
  // A managed material (a glTF clone's shared material) is cache-owned — leave it.
  if (AssetCache.isManaged(material as { userData?: Record<string, unknown> })) return;
  const m = material as Record<string, unknown> & {
    dispose?: () => void;
    uniforms?: Record<string, { value?: unknown }>;
  };
  for (const value of Object.values(m)) {
    if (isTexture(value) && !AssetCache.isManaged(value)) value.dispose();
  }
  if (m.uniforms) {
    for (const uniform of Object.values(m.uniforms)) {
      const value = uniform?.value;
      if (isTexture(value) && !AssetCache.isManaged(value)) value.dispose();
    }
  }
  m.dispose?.();
}

/** A three.js Texture, structurally (avoids importing the class). */
function isTexture(value: unknown): value is { dispose(): void; userData?: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && (value as { isTexture?: boolean }).isTexture === true;
}

/** mulberry32 — a tiny, fast, seedable PRNG for the engine's deterministic `random()`. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
