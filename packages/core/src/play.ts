import { Camera, Euler, Object3D, Scene, Timer, Vector2, Vector3, WebGLRenderer, type OrthographicCamera, type PerspectiveCamera, type Quaternion } from 'three';
import { Runtime, wake, provideCamera, type RenderCamera } from './kernel/index.js';
import { Input } from './input/Input.js';
import { installObserverBridge, isHeld, viewOf } from './observe.js';
import { SceneManager, attachWorld, loadInto } from './scenes.js';
import { installEditor, markSpawned, sizeCanvas, startOpenedScene } from './editor/index.js';
import { Model } from './assets/Model.js';
import type { Prefab } from './kernel/types.js';
import { isPrefab } from './jsx.js';

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
  /**
   * Whether `play` picks the camera and fits it to the screen — on by default: the scene's first
   * visible camera draws, its aspect kept to the canvas. `false` leaves cameras to the game: set
   * `game.camera`, size it as the canvas changes, or draw your own way through `game.render`.
   */
  autoCamera?: boolean;
}

export interface Game {
  /** The scene everything is in. `SceneManager.load` swaps what is in it, not the object. */
  readonly scene: Scene;
  /**
   * The camera drawing the scene — what `this.camera` is. Picked by `play` unless `autoCamera` is
   * false: then it is what the game sets here, and null draws nothing until `game.render` says otherwise.
   */
  camera: RenderCamera | null;
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
  const scene = new Scene();
  const runtime = new Runtime(scene, { fixedDelta: options.fixedDelta });

  const renderer = options.renderer ?? new WebGLRenderer({ antialias: true });
  if (!options.renderer) renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const host = options.container ?? document.body;
  const autoCamera = options.autoCamera ?? true;
  host.appendChild(renderer.domElement);

  let camera: RenderCamera | null = null;
  /**
   * Frames drawn without a camera since the last load. Said once, a second in: a scene that loads the
   * next one on its first frame — a bootstrap — never needs one, but an empty screen needs a reason.
   */
  let framesWithoutCamera = 0;
  const size = new Vector2();
  const fit = () => {
    renderer.getSize(size);
    if (!camera || !autoCamera) return;
    const aspect = size.x / size.y;
    if ((camera as OrthographicCamera).isOrthographicCamera) {
      // Unity's orthographic size: the height it shows is the scene's, the width follows the screen.
      const ortho = camera as OrthographicCamera;
      const half = ((ortho.top - ortho.bottom) / 2) * aspect;
      const middle = (ortho.left + ortho.right) / 2;
      ortho.left = middle - half;
      ortho.right = middle + half;
    } else {
      (camera as PerspectiveCamera).aspect = aspect;
    }
    camera.updateProjectionMatrix();
  };
  // Every load may bring its own camera: the newest scene's first visible camera draws, then a kept
  // one's. Hidden or taken out of the scene, it hands over to the next — Unity's `camera.enabled`.
  const findCamera = () => {
    if (!autoCamera) return;
    let found: RenderCamera | null = null;
    const look = (root: Object3D) =>
      root.traverseVisible((node) => void (found ??= (node as Camera).isCamera ? (node as RenderCamera) : null));
    for (const loaded of SceneManager.loadedScenes) look(loaded);
    if (!found) look(scene);
    if (found !== camera) framesWithoutCamera = 0;
    camera = found;
    fit();
  };
  /** Whether the drawing camera is still in the world and seen: otherwise another takes over. */
  const drawable = (node: Object3D | null) => {
    for (let at = node; at; at = at.parent) {
      if (!at.visible) return false;
      if (at === scene) return true;
    }
    return false;
  };
  const noCamera = 'The scene has no camera, so nothing is drawn. Put one in it, as in Unity: <PerspectiveCamera position={[0, 2, 6]} />';
  const resize = () => {
    // In development the editor's bar or panel may take part of the page: it sizes the canvas then.
    if (!(import.meta.env?.DEV && sizeCanvas(renderer, host))) {
      const page = host === document.body;
      renderer.setSize(page ? innerWidth : host.clientWidth, page ? innerHeight : host.clientHeight);
    }
    fit();
  };
  resize();
  addEventListener('resize', resize);

  provideCamera(runtime, () => camera);
  attachWorld(scene, findCamera);
  // Before the scene is built: a reset in the editor holds behaviours from their very first wake.
  const editor = import.meta.env?.DEV ? installEditor(scene, runtime, renderer, () => camera, (dt) => frame(dt)) : null;
  // In development the editor may have opened another scene: the page starts in it instead.
  let starting = import.meta.env?.DEV ? startOpenedScene(scene, build) : null;
  if (starting) void starting.finally(() => (starting = null));
  else loadInto(scene, build, false);
  Input.attach(renderer.domElement);

  const game: Game = {
    scene,
    get camera() {
      return camera;
    },
    set camera(value) {
      camera = value;
      fit();
    },
    renderer,
    runtime,
    render: () => {
      if (camera) renderer.render(scene, camera);
    },
  };

  /** One frame of the game: input first, then every behaviour, then input's one-frame edges roll over. */
  const frame = (dt: number) => {
    editor?.beforeFrame();
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
    if (starting) return;
    if (!(import.meta.env?.DEV && isHeld(runtime))) {
      frame(timer.getDelta());
      editor?.afterFrame();
    }
    if (autoCamera && !drawable(camera)) findCamera();
    const view = import.meta.env?.DEV ? viewOf(runtime) : null;
    if (view) renderer.render(scene, view);
    else if (camera || !autoCamera) game.render();
    else if (++framesWithoutCamera === 60) console.error(noCamera);
    if (view ?? camera) editor?.draw((view ?? camera)!);
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
 * Unity's `Instantiate` for a prefab — what `prefab()` made — or a loaded model. It builds a
 * fresh copy, places it, and wakes it: `awake` and `onEnable` run before this returns, `start` next
 * frame, so fields set on its behaviours right after this call are in by `start`. Nothing is
 * cloned from a live node: every call makes its own objects.
 */
export function instantiate<T extends Object3D = Object3D>(prefab: Prefab<T> | Model, options: InstantiateOptions = {}): T {
  const name = prefab instanceof Model ? `"${prefab.url}"` : prefab.name || 'prefab';
  if (!(prefab instanceof Model) && !isPrefab(prefab)) {
    throw new Error(`instantiate(${name}): ${name} is a plain function, not a prefab — make it one where it is declared: export const ${prefab.name || 'Coin'} = prefab(() => …).`);
  }
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
  if (import.meta.env?.DEV) markSpawned(made, prefab instanceof Model ? undefined : prefab);
  wake(made);
  return made as T;
}

function setVector(target: Vector3 | Euler, value: Vector3 | Euler | [number, number, number]): void {
  if (Array.isArray(value)) target.set(value[0], value[1], value[2]);
  else (target as Vector3).copy(value as Vector3);
}
