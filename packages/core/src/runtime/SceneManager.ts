import { Scene, type Object3D } from 'three';
import { Time } from './Time.js';
import type { Component } from './Component.js';
import type { ComponentType, SceneType } from './types.js';

/** Notified when a scene finishes loading or unloading. */
export type SceneEventListener = (scene: Scene, type: SceneType) => void;

/**
 * Owns the set of loaded scenes and drives the event cycle.
 *
 * Scenes are identified by their **class**, never by a name string:
 *
 * ```ts
 * await SceneManager.load(MainMenu);
 * SceneManager.getScene(MainMenu)?.score;   // typed as MainMenu
 * ```
 *
 * There is no registry to populate first — the class *is* the key, so `load` can construct
 * it. Code-splitting still works, because a dynamic import hands you the class:
 *
 * ```ts
 * const { Level2 } = await import('./scenes/Level2');
 * await SceneManager.load(Level2);
 * ```
 *
 * The frame is pumped by `tick`, which runs the phases in a fixed order:
 * `fixedUpdate` (0..n times) → `update` → coroutines → `lateUpdate` → deferred destruction.
 * `Engine` calls it for you; call it yourself if you already have a render loop.
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
      // A scene that survives a load is the whole point of `dontDestroyOnLoad`, and the
      // persistent scene below is one of these.
      if (this.loaded.get(other)?.dontDestroyOnLoad) continue;
      await this.unload(other);
    }
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
   * It is an ordinary loaded scene, which is the point: it ticks, it is searched by
   * `findObjectOfType`, and its components get every hook. The only thing special about it is
   * the flag that keeps `load` from unloading it. Created on first use, so a game that never
   * persists anything never has one.
   */
  get persistentScene(): Scene {
    let scene = this.loaded.get(PersistentScene);
    if (scene) return scene;
    scene = new PersistentScene();
    scene.name = 'DontDestroyOnLoad';
    scene.dontDestroyOnLoad = true;
    this.typeOfScene.set(scene, PersistentScene);
    // `Scene.load` has nothing to await here — no `onLoad` — so the parts that matter (the
    // runtime, the loaded flag) are in place by the time this returns.
    void scene.load();
    this.loaded.set(PersistentScene, scene);
    return scene;
  }

  /** Every loaded scene that survives a `load`, the persistent one included. */
  get persistentScenes(): Scene[] {
    return [...this.loaded.values()].filter((scene) => scene.dontDestroyOnLoad);
  }

  /**
   * Keep something across a scene load — Unity's `DontDestroyOnLoad`, with the same two uses.
   *
   * Given a **node**, it is moved into the persistent scene: it keeps its components, its
   * children and its local transform, and it is drawn on top of whatever scene is active.
   * Its `onDisable`/`onEnable` fire around the move, because it really does leave one scene
   * and join another.
   *
   * ```ts
   * SceneManager.dontDestroyOnLoad(this.object3D);   // this node outlives the level
   * ```
   *
   * Given a **scene**, it marks the scene itself exempt, which is the tidier answer when what
   * survives is a whole document — a HUD, a pause menu, an audio rig:
   *
   * ```ts
   * const hud = await SceneManager.loadAdditive(HudScene);
   * SceneManager.dontDestroyOnLoad(hud);
   * ```
   *
   * Prefer the scene form where you can. `loadAdditive` of an already-loaded scene is a no-op,
   * so every level may ask for the HUD and exactly one exists — where a node persisted by two
   * different levels leaves you with two of it, exactly as it does in Unity.
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
   * The first component of `type` in **any** loaded scene, or `null` — Unity's
   * `Object.FindObjectOfType`, which is likewise global rather than per-scene.
   *
   * `scene.findObjectOfType` searches one scene. This searches all of them, which is what a
   * freshly-loaded level needs to reach something that outlived the last one.
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
    // The first frame has no previous timestamp; give it a nominal delta rather than 0 so
    // anything easing off `deltaTime` does not divide by zero.
    const delta = previous === null ? 1 / 60 : Math.max(0, (timestamp - previous) / 1000);
    Time.advance(delta);

    // A snapshot: a scene may load or unload another from inside a hook.
    const scenes = [...this.loaded.values()];

    // Work out the fixed steps once, then interleave the scenes within each step, so two
    // additive scenes never drift apart by a step.
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
    // Published before the phases run, so a system's `update` can blend between the two fixed
    // poses its own `fixedUpdate` just recorded.
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
 * The class of the persistent scene.
 *
 * A real class rather than a bare `Scene` instance because scenes are keyed by class here, and
 * making the persistent one an ordinary entry in that map is what lets every other part of the
 * manager — the frame pump, the lookups, `unloadAll` — treat it like any other scene.
 */
class PersistentScene extends Scene {}

function remove<T>(list: T[], value: T): void {
  const index = list.indexOf(value);
  if (index !== -1) list.splice(index, 1);
}

export const SceneManager = new SceneManagerClass();
export type { SceneManagerClass };
