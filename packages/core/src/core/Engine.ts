import { type Camera, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import type { Object3D } from 'three';
import type { Component } from './Component.js';
import { InputManager } from './Input.js';
import { runsInEditor } from './decorators.js';
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

  private readonly components: Component[] = [];
  private readonly byNode = new Map<Object3D, Component[]>();
  private readonly byId = new Map<string, Component>();
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
  /** Live attachment instances of the loaded scene (retained for findAttachment). */
  private sceneAttachments: AttachmentInstance[] = [];
  /** Tooling map of the loaded scene: live objects ⇄ their compiled-source indices. */
  private sceneGraph?: SceneGraph;
  /** Live spawned roots (from instantiate), so dispose() can tear down subtrees that live outside the scene root. */
  private readonly instances = new Set<Object3D>();

  constructor(options: EngineOptions = {}) {
    this.fixedTimeStep = options.fixedTimeStep ?? 1 / 60;
    this.editorMode = options.editor ?? false;
    this.input = new InputManager({ ...(options.canvas ? { canvas: options.canvas } : {}) });

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
    return this.scene.getObjectByName(id);
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
    if (direct && (!ctor || direct instanceof ctor)) return direct as T;
    const node = this.scene.getObjectByName(id);
    if (node) {
      for (const c of this.getComponents(node)) if (!ctor || c instanceof ctor) return c as T;
    }
    return undefined;
  }

  /**
   * Load a scene from a pre-built bundle (or a CompiledScene), replacing any
   * current one. Bundles are produced at build time by `scenoco/compiler`; the
   * runtime never parses or validates XML. All components are instantiated and
   * their references wired before any onLoad runs, so cross-component refs are
   * valid from the first lifecycle hook.
   *
   * If the scene defines a camera, it becomes `mainCamera`; with none, `mainCamera`
   * stays undefined and the loop skips rendering until one is set.
   */
  loadScene(source: Bundle | CompiledScene): void {
    if (Array.isArray(source) && bundleKind(source) === 'prefab') {
      throw new Error('loadScene() received a prefab bundle — use engine.instantiate() to spawn a prefab.');
    }
    const compiled = Array.isArray(source) ? deserializeBundle(source) : source;

    // Full swap: tear the current scene down, then make the compiled Scene the
    // active one. The <Scene> node builds a real Three.js Scene, with fog/background
    // already applied and the camera living in it as a child node.
    this.disposeScene();
    const live = instantiateScene(compiled, this.instantiateContext());
    this.scene = live.root as Scene;
    this.sceneAttachments = live.attachments;
    this.initLive(live);
    this.sceneGraph = buildSceneGraph(compiled, live);
    // Auto-run registered systems whose component type the scene contains — but
    // not in editor mode (no physics/batch processing on a static scene).
    this.sceneSystems = this.editorMode ? [] : this.runSceneSystems();

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
    this.initLive(live);
    this.instances.add(live.root);
    return live.root;
  }

  /**
   * Destroy an object and its whole subtree — Unity/Cocos `Destroy(gameObject)`.
   * Recursively removes every component on the object and its descendants (running
   * their onDisable/onDestroy), detaches it from the scene graph, and frees its GPU
   * resources. Works on any Object3D — a `instantiate`/`PrefabRef.spawn` root, a
   * single node, or a hand-built subtree. Calling it again is a harmless no-op.
   */
  destroy(object: Object3D): void {
    // Collect first: removeComponent mutates byNode as we go. Also forget any
    // spawned root inside this subtree so dispose() won't try to free it twice.
    const components: Component[] = [];
    object.traverse((node) => {
      const onNode = this.byNode.get(node);
      if (onNode) components.push(...onNode);
      this.instances.delete(node);
    });
    for (const c of components) this.removeComponent(c);
    object.removeFromParent();
    disposeObject(object);
  }

  /**
   * Context for `instantiateScene`: how a `prefab` prop spawns — `engine.instantiate`,
   * so spawned subtrees are tracked and torn down by `dispose()`.
   */
  private instantiateContext(): InstantiateContext {
    return {
      spawn: (compiled, parent) => this.instantiate(compiled, parent),
    };
  }

  /** Register + run onLoad/onEnable for a freshly instantiated subtree. */
  private initLive(live: InstantiatedScene): Component[] {
    const components = live.components.map(({ instance }) => instance);
    for (const { instance, node } of live.components) this.registerComponent(node, instance);
    for (const { instance } of live.components) this.initComponent(instance);
    return components;
  }

  /**
   * Unload the active scene: destroy every component on it and free its GPU
   * resources, then leave a fresh empty `Scene` in place. Full swap — anything in
   * the previous scene goes with it (objects you want to keep live on a node that
   * isn't part of the scene, or in a spawned instance).
   */
  disposeScene(): void {
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
    disposeObject(this.scene);
    // Start fresh: an empty scene with no camera (rendering pauses until one loads).
    this.scene = new Scene();
    this.mainCamera = undefined;
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

    // Fixed-timestep phase (deterministic; physics + fixedUpdate). The substep
    // cap prevents a "spiral of death" after a long pause.
    this.fixedAccumulator += dt;
    let steps = 0;
    while (this.fixedAccumulator >= this.fixedTimeStep && steps < MAX_FIXED_SUBSTEPS) {
      this.fixedStep(this.fixedTimeStep);
      this.fixedAccumulator -= this.fixedTimeStep;
      steps++;
    }
    if (steps === MAX_FIXED_SUBSTEPS) this.fixedAccumulator = 0; // drop the backlog

    // Variable-rate phase: start (once) then update.
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i]!;
      if (!c.enabled || !c._loaded) continue;
      if (!c._started) {
        c._started = true;
        c.start?.();
      }
      c.update?.(dt);
    }
    // Late phase: after every update this frame.
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i]!;
      if (c.enabled && c._loaded) c.lateUpdate?.(dt);
    }
    if (!this.editorMode) for (const s of this.systems) s.step?.(dt);

    // Render only when there's both a target and a camera — the engine never
    // supplies a fallback camera, so a scene without one simply doesn't draw.
    if (this.renderer && this.mainCamera) {
      this.resizeToCanvas();
      this.renderer.render(this.scene, this.mainCamera);
    }
  }

  /** One fixed step: components' fixedUpdate (apply forces/read), then subsystems step. */
  private fixedStep(fixedDt: number): void {
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i]!;
      if (c.enabled && c._loaded) c.fixedUpdate?.(fixedDt);
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
    this.renderer?.dispose();
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
      // Keep the main camera's aspect current when it's a perspective camera.
      const camera = this.mainCamera;
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
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

/** Release geometries and materials of every mesh in a subtree. */
function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Object3D & { geometry?: { dispose(): void }; material?: unknown };
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) (m as { dispose(): void }).dispose();
    else (material as { dispose?: () => void } | undefined)?.dispose?.();
  });
}
