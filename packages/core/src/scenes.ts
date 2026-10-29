import { Object3D, Scene } from 'three';
import { Behaviour } from './kernel/Behaviour.js';
import { destroy, wake } from './kernel/runtime.js';

/**
 * Scenes are functions returning `<Scene>…</Scene>`, and `SceneManager` swaps them, as Unity's does.
 *
 * There is one three.js `Scene` for the whole game — the one `play` made, which is what draws and
 * what the runtime runs. A loaded scene is built and added under it; loading another destroys
 * the last one, except what was marked `dontDestroyOnLoad`, which waits directly under the root.
 */

let world: Scene | null = null;
let onLoaded: () => void = () => {};
/** The loaded scenes, oldest first. */
const loaded: Scene[] = [];

/** @internal `play` hands over the scene it draws, and is told after every load. */
export function attachWorld(scene: Scene, changed: () => void): void {
  world = scene;
  onLoaded = changed;
  loaded.length = 0;
}

/** @internal the game `play` made is gone: loads have nowhere to go until the next one. */
export function detachWorld(scene: Scene): void {
  if (world !== scene) return;
  world = null;
  onLoaded = () => {};
  loaded.length = 0;
}

/** @internal build a scene into the world, replacing what was loaded unless `additive`. */
export function loadInto(root: Scene, build: () => unknown, additive: boolean): Scene {
  const built = build();
  if (!(built instanceof Object3D)) {
    // A three.js object that is not this three's: the project has two copies, and `instanceof` across them is false.
    if ((built as { isObject3D?: boolean } | null)?.isObject3D) {
      throw new Error(
        `${build.name || 'A scene'} returned a three.js object from another copy of three.js than SceNoCo's: the project has two (\`npm ls three\` lists them). ` +
          "Install one — `npm dedupe` — or, under Vite or Vitest, add `resolve: { dedupe: ['three'] }` to the config.",
      );
    }
    throw new Error(`${build.name || 'A scene'} must return an element — <Scene>…</Scene>.`);
  }
  const scene = built instanceof Scene ? built : new Scene().add(built);
  if (!additive) {
    for (const old of loaded.splice(0)) destroy(old);
    // What only a top-level scene does in three.js — the backdrop, the fog, the environment — is
    // the loaded scene's to say, so it moves to the scene that draws.
    root.background = scene.background;
    root.environment = scene.environment;
    root.fog = scene.fog;
  }
  loaded.push(scene);
  root.add(scene);
  onLoaded();
  wake(scene);
  return scene;
}

function running(): Scene {
  if (!world) throw new Error('No game is running: start one with play(MainScene) first.');
  return world;
}

/** Unity's `SceneManager`, for scenes that are functions returning `<Scene>…</Scene>`. */
export const SceneManager = {
  /**
   * Unity's `LoadScene`: build `scene` and run it, and destroy the scene that was loaded —
   * everything in it but what `dontDestroyOnLoad` kept. The old one goes at the end of this frame.
   */
  load(scene: () => unknown): Scene {
    return loadInto(running(), scene, false);
  },
  /** Unity's `LoadScene` with `LoadSceneMode.Additive`: build `scene` beside what is loaded. */
  loadAdditive(scene: () => unknown): Scene {
    return loadInto(running(), scene, true);
  },
  /** The scene loaded last. */
  get activeScene(): Scene | null {
    return loaded.at(-1) ?? null;
  },
  /** @internal newest first: where `play` looks for the camera to draw with. */
  get loadedScenes(): readonly Scene[] {
    return [...loaded].reverse();
  },
};

/**
 * Unity's `DontDestroyOnLoad`: this node — or a behaviour's node — and everything under it outlive
 * every later `SceneManager.load`. As in Unity, it is the topmost node that is kept: marking a child
 * keeps the whole tree it is part of. Call it from `awake`.
 */
export function dontDestroyOnLoad(target: Object3D | Behaviour): void {
  const root = running();
  let node = target instanceof Behaviour ? target.node : target;
  // Up to the loaded scene it is in — or to the root, for a node already kept.
  while (node.parent && node.parent !== root && !loaded.includes(node.parent as Scene)) node = node.parent;
  const i = loaded.indexOf(node as Scene);
  if (i !== -1) loaded.splice(i, 1); // a whole loaded scene: it stays where it is, and is no longer unloaded
  else if (node.parent !== root) root.attach(node);
}
