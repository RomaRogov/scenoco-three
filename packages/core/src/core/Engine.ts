import { type Camera, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import type { Object3D } from 'three';
import type { Component } from './Component.js';
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

export interface EngineOptions {
  /** Render target. Omit for headless use (tests, CLI tooling, validation). */
  canvas?: HTMLCanvasElement;
  /** Start the render loop immediately when a canvas is given. Default true. */
  autoStart?: boolean;
  /** Seconds per fixed step (physics + `fixedUpdate`). Default 1/60. */
  fixedTimeStep?: number;
}

/**
 * A spawned prefab/subtree (from `engine.instantiate`). Hold onto it to remove
 * the subtree later — Unity/Cocos `Instantiate` → `Destroy`.
 */
export interface SceneInstance {
  /** Root Object3D of the spawned subtree. */
  readonly root: Object3D;
  /** Remove the subtree, destroy its components, and free its GPU resources. */
  destroy(): void;
}

/**
 * Core runtime: owns the Three.js scene graph, the render loop, and the
 * lifecycles of all attached components.
 *
 * Without a canvas the engine runs headless — `tick(dt)` advances the
 * simulation manually, which is how tests and CLI tooling drive it.
 */
export class Engine {
  readonly scene = new Scene();
  /** The engine's built-in fallback camera, used until a scene supplies one. */
  readonly camera: PerspectiveCamera;
  readonly renderer?: WebGLRenderer;

  /** Camera the renderer currently draws through (defaults to `camera`). */
  private activeCamera: Camera;

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
  /** Root object of the currently loaded scene (from loadScene), if any. */
  private sceneRoot?: Object3D;
  /** Components owned by the loaded scene — the only ones disposeScene removes. */
  private sceneComponents: Component[] = [];
  /** Systems auto-run for the loaded scene — removed on unload. */
  private sceneSystems: System[] = [];
  /** Live attachment instances of the loaded scene (retained for findAttachment). */
  private sceneAttachments: AttachmentInstance[] = [];
  /** Live spawned subtrees (from instantiate), so dispose() can clean them up. */
  private readonly instances = new Set<SceneInstance>();

  constructor(options: EngineOptions = {}) {
    this.fixedTimeStep = options.fixedTimeStep ?? 1 / 60;
    this.camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    this.camera.position.set(0, 2, 6);
    this.camera.lookAt(0, 0, 0);
    this.activeCamera = this.camera;

    if (options.canvas) {
      this.renderer = new WebGLRenderer({ canvas: options.canvas, antialias: true });
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

  /** Run onLoad + onEnable for an already-registered instance. */
  private initComponent(instance: Component): void {
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
    instance.onDestroy?.();
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

  /** The camera the renderer draws through (a scene camera if one is active). */
  get renderCamera(): Camera {
    return this.activeCamera;
  }

  /**
   * Render through a specific camera — e.g. one defined in the scene
   * (`engine.setActiveCamera(engine.findObject('Main')!)`). `loadScene` already
   * auto-selects the first camera it finds; this is for switching afterwards.
   * Pass nothing to revert to the engine's built-in camera.
   */
  setActiveCamera(camera: Camera = this.camera): void {
    this.activeCamera = camera;
  }

  /**
   * Load a scene from a pre-built bundle (or a CompiledScene), replacing any
   * current one. Bundles are produced at build time by `scenoco/compiler`; the
   * runtime never parses or validates XML. All components are instantiated and
   * their references wired before any onLoad runs, so cross-component refs are
   * valid from the first lifecycle hook.
   *
   * If the scene defines a camera, it becomes the active render camera; the
   * engine's built-in camera is the fallback when it doesn't.
   */
  loadScene(source: Bundle | CompiledScene): void {
    if (Array.isArray(source) && bundleKind(source) === 'prefab') {
      throw new Error('loadScene() received a prefab bundle — use engine.instantiate() to spawn a prefab.');
    }
    const compiled = Array.isArray(source) ? deserializeBundle(source) : source;

    this.disposeScene();
    // Attachments (geometry/material on nodes, fog/background on the scene) are
    // applied during instantiation against the live scene/renderer.
    const live = instantiateScene(compiled, this.instantiateContext());
    this.sceneRoot = live.root;
    this.sceneAttachments = live.attachments;
    this.scene.add(live.root);
    this.sceneComponents = this.initLive(live);
    // Auto-run registered systems whose component type the scene contains.
    this.sceneSystems = this.runSceneSystems();

    const sceneCamera = findCamera(live.root);
    if (sceneCamera) this.setActiveCamera(sceneCamera);
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
   * Returns a handle whose `destroy()` removes just this subtree; the loaded
   * scene and other instances are untouched. References inside the prefab are
   * already wired by index, so spawning the same prefab many times is safe.
   */
  instantiate(source: Bundle | CompiledScene, parent: Object3D = this.scene): SceneInstance {
    const compiled = Array.isArray(source) ? deserializeBundle(source) : source;
    const live = instantiateScene(compiled, this.instantiateContext());
    parent.add(live.root);
    const components = this.initLive(live);

    const instance: SceneInstance = {
      root: live.root,
      destroy: () => {
        if (!this.instances.delete(instance)) return;
        for (const c of components) this.removeComponent(c);
        live.root.removeFromParent();
        disposeObject(live.root);
      },
    };
    this.instances.add(instance);
    return instance;
  }

  /**
   * Context for `instantiateScene`: the live scene/renderer (for attachments)
   * and how a `prefab` prop spawns — `engine.instantiate`, so spawned subtrees
   * are tracked and torn down by `dispose()`.
   */
  private instantiateContext(): InstantiateContext {
    return {
      scene: this.scene,
      ...(this.renderer ? { renderer: this.renderer } : {}),
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
   * Remove the loaded scene: destroy its components (only those owned by the
   * scene — manually attached ones and spawned instances survive) and release
   * its GPU resources.
   */
  disposeScene(): void {
    if (!this.sceneRoot) return;
    // Components first (a RigidBody.onDisable removes its body), then the
    // subsystems they used (PhysicsSystem.onDetach frees the world).
    for (const c of this.sceneComponents) this.removeComponent(c);
    this.sceneComponents = [];
    for (const s of this.sceneSystems) this.removeSystem(s);
    this.sceneSystems = [];
    this.sceneAttachments = [];
    this.scene.remove(this.sceneRoot);
    disposeObject(this.sceneRoot);
    this.sceneRoot = undefined;
    // Reset the built-in scene settings so they don't leak into the next scene.
    this.scene.fog = null;
    this.scene.background = null;
    // The scene's camera is gone; fall back to the built-in one.
    this.activeCamera = this.camera;
  }

  /**
   * Advance the simulation by dt seconds, then render if a renderer exists.
   * Phases, in order: fixed steps (`fixedUpdate` + subsystem `fixedStep`,
   * repeated to drain the accumulator) → `start`/`update` → `lateUpdate` →
   * subsystem `step` → render. Variable `update` still runs exactly once per
   * tick, so existing components are unaffected.
   */
  tick(dt: number): void {
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
    for (const s of this.systems) s.step?.(dt);

    if (this.renderer) {
      this.resizeToCanvas();
      this.renderer.render(this.scene, this.activeCamera);
    }
  }

  /** One fixed step: components' fixedUpdate (apply forces/read), then subsystems step. */
  private fixedStep(fixedDt: number): void {
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i]!;
      if (c.enabled && c._loaded) c.fixedUpdate?.(fixedDt);
    }
    for (const s of this.systems) s.fixedStep?.(fixedDt);
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
    for (const instance of [...this.instances]) instance.destroy();
    this.disposeScene();
    for (const c of [...this.components]) this.removeComponent(c);
    for (const s of [...this.systems]) this.removeSystem(s);
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
      // Keep the built-in camera's aspect current; update the active scene
      // camera too when it's a perspective camera.
      const aspect = width / height;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      const active = this.activeCamera;
      if (active !== this.camera && active instanceof PerspectiveCamera) {
        active.aspect = aspect;
        active.updateProjectionMatrix();
      }
    }
  }
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
