import { Scene, type Object3D } from 'three';
import { Time } from './Time.js';
import { Input } from '../input/Input.js';
import type { Component } from './Component.js';
import type { ComponentType, SceneType } from './types.js';

/** Notified when a scene finishes loading or unloading. */
export type SceneEventListener = (scene: Scene, type: SceneType) => void;

/**
 * Owns the set of loaded scenes and drives the event cycle.
 *
 * Scenes are identified by their **class**, never a name string: there is no registry to
 * populate, since the class is the key and `load` constructs it.
 *
 * `tick` runs the phases in order — `fixedUpdate` (0..n times) → `update` → coroutines →
 * `lateUpdate` → deferred destruction. `Engine` calls it, or call it from your own loop.
 */
class SceneManagerClass {
  private readonly loaded = new Map<SceneType, Scene>();
  private readonly typeOfScene = new WeakMap<Scene, SceneType>();
  /** In-flight loads, so a double `load()` of the same class awaits one operation. */
  private readonly pending = new Map<SceneType, Promise<Scene>>();
  private readonly loadedListeners: SceneEventListener[] = [];
  private readonly unloadedListeners: SceneEventListener[] = [];

  private active: Scene | null = null;
  private lastTimestamp: number | null = null;
  /** Unspent scaled time owed to `fixedUpdate`. Global, so additive scenes stay in lockstep. */
  private fixedAccumulator = 0;

  /** The scene `Engine` renders. */
  get activeScene(): Scene | null {
    return this.active;
  }

  /** Every scene currently loaded, in load order. */
  get loadedScenes(): Scene[] {
    return [...this.loaded.values()];
  }

  /** The class a loaded scene was created from. */
  typeOf(scene: Scene): SceneType | null {
    return this.typeOfScene.get(scene) ?? null;
  }

  /** True when a scene of this class is loaded. */
  isLoaded(type: SceneType): boolean {
    return this.loaded.has(type);
  }

  /** The loaded instance of `type`, typed as that class, or `null`. */
  getScene<T extends Scene>(type: SceneType<T>): T | null {
    return (this.loaded.get(type) as T | undefined) ?? null;
  }

  // --- loading --------------------------------------------------------------------------

  /**
   * Unload every other scene, then construct and load `type` and make it active.
   * `await SceneManager.load(Level1)` returns with the scene fully built.
   */
  async load<T extends Scene>(type: SceneType<T>): Promise<T> {
    for (const other of [...this.loaded.keys()]) {
      if (other === type) continue;
      if (this.loaded.get(other)?.dontDestroyOnLoad) continue;
      await this.unload(other);
    }
    // Loading the scene that is already loaded is a **restart**, the ordinary way a game says
    // "again". `loadAdditive` keeps the no-op instead: asking twice for the HUD makes one HUD.
    if (this.loaded.has(type)) await this.unload(type);
    const scene = await this.loadAdditive(type);
    this.setActiveScene(scene);
    return scene;
  }

  /** Load `type` alongside whatever is already loaded, without changing the active scene. */
  async loadAdditive<T extends Scene>(type: SceneType<T>): Promise<T> {
    const existing = this.loaded.get(type);
    if (existing) return existing as T;
    const inFlight = this.pending.get(type);
    if (inFlight) return inFlight as Promise<T>;

    const operation = (async () => {
      const scene = new type();
      requireAugmented(scene);
      this.typeOfScene.set(scene, type);
      await scene.load();
      this.loaded.set(type, scene);
      this.active ??= scene;
      for (const listener of this.loadedListeners.slice()) listener(scene, type);
      return scene;
    })();

    this.pending.set(type, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(type);
    }
  }

  /** Unload a scene by class, or the active scene when called with no argument. */
  async unload(type?: SceneType): Promise<void> {
    const key = type ?? (this.active ? this.typeOfScene.get(this.active) : undefined);
    if (!key) return;
    const scene = this.loaded.get(key);
    if (!scene) return;

    this.loaded.delete(key);
    await scene.unload();
    if (this.active === scene) this.active = this.loaded.values().next().value ?? null;
    for (const listener of this.unloadedListeners.slice()) listener(scene, key);
  }

  /** Unload everything. */
  async unloadAll(): Promise<void> {
    for (const type of [...this.loaded.keys()]) await this.unload(type);
    this.active = null;
  }

  /** Make an already-loaded scene the active one. */
  setActiveScene(scene: Scene): this {
    this.active = scene;
    return this;
  }

  // --- surviving a load -------------------------------------------------------------------

  /**
   * The scene persistent objects live in — Unity's `DontDestroyOnLoad` scene, by that name.
   *
   * An ordinary loaded scene in every respect but the flag that keeps `load` from unloading it.
   * Created on first use.
   */
  get persistentScene(): Scene {
    let scene = this.loaded.get(PersistentScene);
    if (scene) return scene;
    scene = new PersistentScene();
    scene.name = 'DontDestroyOnLoad';
    scene.dontDestroyOnLoad = true;
    this.typeOfScene.set(scene, PersistentScene);
    // Nothing to await — no `onLoad` — so the runtime and the loaded flag are in place already.
    void scene.load();
    this.loaded.set(PersistentScene, scene);
    return scene;
  }

  /** Every loaded scene that survives a `load`, the persistent one included. */
  get persistentScenes(): Scene[] {
    return [...this.loaded.values()].filter((scene) => scene.dontDestroyOnLoad);
  }

  /**
   * Keep something across a scene load — Unity's `DontDestroyOnLoad`.
   *
   * A **node** is moved into the persistent scene, keeping its components, children and local
   * transform; its `onDisable`/`onEnable` fire around the move. A **scene** is marked exempt
   * where it stands.
   *
   * Prefer the scene form: `loadAdditive` of a loaded scene is a no-op, so every level may ask
   * for the HUD and one exists, where a node persisted by two levels leaves you with two.
   */
  dontDestroyOnLoad<T extends Object3D>(target: T): T {
    if (target instanceof Scene) {
      target.dontDestroyOnLoad = true;
      return target;
    }
    this.persistentScene.add(target);
    return target;
  }

  // --- finding ----------------------------------------------------------------------------

  /**
   * The first component of `type` in **any** loaded scene — Unity's `Object.FindObjectOfType`,
   * likewise global. `scene.findObjectOfType` searches one scene.
   */
  findObjectOfType<T extends Component>(type: ComponentType<T>, includeInactive = false): T | null {
    for (const scene of this.loaded.values()) {
      const found = scene.findObjectOfType(type, includeInactive);
      if (found) return found;
    }
    return null;
  }

  /** Every component of `type` in every loaded scene. Unity's `Object.FindObjectsOfType`. */
  findObjectsOfType<T extends Component>(type: ComponentType<T>, includeInactive = false): T[] {
    const found: T[] = [];
    for (const scene of this.loaded.values()) {
      found.push(...scene.findObjectsOfType(type, includeInactive));
    }
    return found;
  }

  // --- events ---------------------------------------------------------------------------

  /** Called after a scene finishes loading. Returns an unsubscribe function. */
  onSceneLoaded(listener: SceneEventListener): () => void {
    this.loadedListeners.push(listener);
    return () => remove(this.loadedListeners, listener);
  }

  /** Called after a scene finishes unloading. Returns an unsubscribe function. */
  onSceneUnloaded(listener: SceneEventListener): () => void {
    this.unloadedListeners.push(listener);
    return () => remove(this.unloadedListeners, listener);
  }

  // --- the frame ------------------------------------------------------------------------

  /**
   * Advance every loaded scene by one frame.
   * @param timestamp a `performance.now()`-style value in milliseconds, as handed to
   * `requestAnimationFrame`. Omit it to have the manager read the clock itself.
   */
  tick(timestamp: number = performance.now()): void {
    const previous = this.lastTimestamp;
    this.lastTimestamp = timestamp;
    // The first frame has no previous timestamp, and a delta of 0 divides by zero downstream.
    const delta = previous === null ? 1 / 60 : Math.max(0, (timestamp - previous) / 1000);
    Time.advance(delta);
    // Before any component runs, so `update` reads an axis belonging to this frame. Unscaled: a
    // game frozen at `timeScale = 0` still has to notice the key that unfreezes it.
    Input.advance(Time.unscaledDeltaTime);

    // A snapshot: a scene may load or unload another from inside a hook.
    const scenes = [...this.loaded.values()];

    // Steps counted once and the scenes interleaved within each, so two additive scenes never
    // drift apart by a step.
    const step = Time.fixedDeltaTime;
    let steps = 0;
    if (step > 0) {
      this.fixedAccumulator += Time.deltaTime;
      // Cap the catch-up burst: a long stall must not lock the frame up chasing lost time.
      const maxSteps = 8;
      while (this.fixedAccumulator >= step && steps < maxSteps) {
        this.fixedAccumulator -= step;
        steps++;
      }
      if (steps === maxSteps) this.fixedAccumulator = 0;
    }
    // Before the phases, so an `update` can blend the two poses its `fixedUpdate` just recorded.
    Time.interpolationAlpha = step > 0 ? this.fixedAccumulator / step : 0;
    for (let i = 0; i < steps; i++) {
      Time.advanceFixed();
      for (const scene of scenes) scene._runtime.runFixedStep();
    }

    for (const scene of scenes) scene._runtime.runUpdates();
    for (const scene of scenes) scene._runtime.runLateUpdates();
    for (const scene of scenes) scene._runtime.endFrame();
  }

  /**
   * Forget the last frame's timestamp, so the next `tick` produces a nominal delta instead of
   * a huge one. Call it after a long synchronous load or when resuming from a paused tab.
   */
  resetFrameClock(): void {
    this.lastTimestamp = null;
    this.fixedAccumulator = 0;
  }
}

/**
 * Check that this scene is one core augmented, and say what it means when it is not.
 *
 * The augmentation patches the prototypes of *one* `three`. A project that resolves two copies
 * builds its scenes from the other one, and every symptom after this point — `load is not a
 * function`, a scene that ticks nothing — points anywhere but at the cause.
 */
function requireAugmented(scene: Scene): void {
  if (typeof scene.load === 'function') return;
  throw new Error(
    `[scenoco] ${scene.constructor.name} was built from a different copy of three.js than the ` +
      'one @scenoco-three/core augmented, so it has none of the engine on it. Check for a ' +
      'duplicate `three` in node_modules — core declares it as a peer dependency for this reason.',
  );
}

/** The class of the persistent scene, so it is an ordinary entry in the by-class map. */
class PersistentScene extends Scene {}

function remove<T>(list: T[], value: T): void {
  const index = list.indexOf(value);
  if (index !== -1) list.splice(index, 1);
}

export const SceneManager = new SceneManagerClass();
export type { SceneManagerClass };
