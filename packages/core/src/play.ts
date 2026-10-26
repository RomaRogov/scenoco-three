import { Camera, Euler, Object3D, PerspectiveCamera, Scene, Timer, Vector2, Vector3, WebGLRenderer, type Quaternion } from 'three';
import { Runtime, wake, provideCamera, type RenderCamera } from './kernel/index.js';
import { Input } from './input/Input.js';
import { installObserverBridge, isHeld } from './observe.js';
import { SceneManager, attachWorld, loadInto } from './scenes.js';
import { edit } from './edit.js';
import { Model } from './assets/Model.js';
import type { Prefab } from './kernel/types.js';

export interface PlayOptions {
  /** Where the canvas goes. `document.body` when left out. */
  container?: HTMLElement;
  /** Seconds per `fixedUpdate`. Unity's default, 0.02. */
  fixedDelta?: number;
  /**
   * The renderer to draw with, for what only its constructor sets — `new WebGLRenderer({ antialias:
   * false, powerPreference: 'high-performance' })`. One with antialiasing when left out.
   */
  renderer?: WebGLRenderer;
}

export interface Game {
  /** The scene everything is in. `SceneManager.load` swaps what is in it, not the object. */
  readonly scene: Scene;
  /** The camera drawing the scene now: the loaded scene's first camera, or a default one. */
  readonly camera: RenderCamera;
  /** three.js's renderer: shadows, tone mapping and the rest are set on it as three.js documents. */
  readonly renderer: WebGLRenderer;
  readonly runtime: Runtime;
  /**
   * Draws one frame. Replace it to draw another way — an `EffectComposer` for post effects:
   * `game.render = () => composer.render()`.
   */
  render: () => void;
}

/**
 * Build a scene and run it: `play(Main)`, where `Main` is a function returning `<Scene>…</Scene>`.
 * The scene's first camera draws it; behaviours start on the first frame. Returns three.js's own
 * objects, to configure as three.js does.
 */
export function play(build: () => unknown, options: PlayOptions = {}): Game {
  // `?edit` in development: the same scene, built and held still, for the editor.
  if (import.meta.env?.DEV && new URLSearchParams(location.search).has('edit')) return edit(build, options);
  const scene = new Scene();
  const runtime = new Runtime(scene, { fixedDelta: options.fixedDelta });
  const fallback = new PerspectiveCamera(50, 1, 0.1, 1000);
  fallback.position.set(0, 0, 5);

  const renderer = options.renderer ?? new WebGLRenderer({ antialias: true });
  if (!options.renderer) renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const host = options.container ?? document.body;
  host.appendChild(renderer.domElement);

  let camera: RenderCamera = fallback;
  const size = new Vector2();
  const fit = () => {
    renderer.getSize(size);
    camera.aspect = size.x / size.y;
    camera.updateProjectionMatrix();
  };
  // Every load may bring its own camera: the newest scene's first camera draws, then a kept one.
  const findCamera = () => {
    let found: RenderCamera | null = null;
    const look = (root: Object3D) => root.traverse((node) => void (found ??= (node as Camera).isCamera ? (node as RenderCamera) : null));
    for (const loaded of SceneManager.loadedScenes) look(loaded);
    if (!found) look(scene);
    camera = found ?? fallback;
    fit();
  };
  const resize = () => {
    const width = host === document.body ? innerWidth : host.clientWidth;
    const height = host === document.body ? innerHeight : host.clientHeight;
    renderer.setSize(width, height);
    fit();
  };
  resize();
  addEventListener('resize', resize);

  provideCamera(runtime, () => camera);
  attachWorld(scene, findCamera);
  loadInto(scene, build, false);
  Input.attach(renderer.domElement);

  const game: Game = {
    scene,
    get camera() {
      return camera;
    },
    renderer,
    runtime,
    render: () => renderer.render(scene, camera),
  };

  /** One frame of the game: input first, then every behaviour, then input's one-frame edges roll over. */
  const frame = (dt: number) => {
    Input.advance(Math.min(Math.max(dt, 0), runtime.maxDelta));
    runtime.update(dt);
    Input.endFrame();
  };
  if (import.meta.env?.DEV) {
    installObserverBridge(runtime, () => ({ scene, camera, gl: renderer, size: { width: size.x, height: size.y } }), frame);
  }

  const timer = new Timer();
  timer.connect(document);
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    if (!isHeld(runtime)) frame(timer.getDelta());
    game.render();
  });
  return game;
}

export interface InstantiateOptions {
  /** Where it goes. The active scene when left out, as in Unity: the next scene load takes it too. */
  parent?: Object3D;
  position?: Vector3 | [number, number, number];
  rotation?: Euler | [number, number, number];
  quaternion?: Quaternion;
}

/**
 * Unity's `Instantiate` for a prefab — a function returning TSX — or a loaded model. It builds a
 * fresh copy, places it, and wakes it: `awake` and `onEnable` run before this returns, `start` next
 * frame, so fields set on its behaviours right after this call are in by `start`. Nothing is
 * cloned from a live node: every call makes its own objects.
 */
export function instantiate<T extends Object3D = Object3D>(prefab: Prefab<T> | Model, options: InstantiateOptions = {}): T {
  const name = prefab instanceof Model ? `"${prefab.url}"` : prefab.name || 'prefab';
  const made = prefab instanceof Model ? prefab.instantiate() : prefab();
  if (!(made instanceof Object3D)) throw new Error(`instantiate(${name}): a prefab returns one element, such as <Group>…</Group>.`);
  if (options.position) setVector(made.position, options.position);
  if (options.rotation) setVector(made.rotation, options.rotation);
  if (options.quaternion) made.quaternion.copy(options.quaternion);
  // As in Unity, into the active scene: the next scene load destroys it too. Only with no scene
  // loaded — a bare runtime — does it go to the root.
  const root = Runtime.current?.root as Object3D | undefined;
  const active = SceneManager.activeScene;
  const parent = options.parent ?? (active && active.parent === root ? active : root);
  if (!parent) throw new Error(`instantiate(${name}) has nowhere to go: no parent, and no scene is running.`);
  parent.add(made);
  wake(made);
  return made as T;
}

function setVector(target: Vector3 | Euler, value: Vector3 | Euler | [number, number, number]): void {
  if (Array.isArray(value)) target.set(value[0], value[1], value[2]);
  else (target as Vector3).copy(value as Vector3);
}
