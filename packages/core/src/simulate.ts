import { Scene, Vector3 } from 'three';
import { Runtime, destroy, provideCamera, type RenderCamera } from './kernel/index.js';
import { flushDestroyed } from './kernel/lifecycle.js';
import { Input } from './input/Input.js';
import type { KeyCode } from './input/KeyCode.js';
import { attachWorld, detachWorld, loadInto } from './scenes.js';
import { MouseButton } from './input/KeyCode.js';
import { fitCamera, sceneCamera } from './play.js';
import { Screen, setScreenSize } from './Screen.js';

export interface SimulateOptions {
  /** Seconds per `fixedUpdate`. Unity's default, 0.02. */
  fixedDelta?: number;
  /** The screen, in pixels: what `Screen` says and what pointer positions are on. Default 1920×1080. */
  size?: [width: number, height: number];
  /**
   * The game's page, as text — `import page from '../index.html?raw'` — so its UI is there: what
   * `UIDocument` lays out and `click('Play')` presses. Its `<body>` without scripts becomes the
   * document's, in jsdom, until `dispose`.
   */
  page?: string;
}

/** A point of the screen in pixels from its top-left, as the page's bridge takes them. */
export type ScreenPoint = [x: number, y: number];

/** A game run by a test: no canvas and no loop — its frames pass when `step` says. */
export interface Simulation {
  /** The scene everything is in, as `play`'s. */
  readonly scene: Scene;
  /** The camera that would draw — what `this.camera` is. Nothing is drawn. */
  readonly camera: RenderCamera | null;
  readonly runtime: Runtime;
  /** Run `frames` frames of `dt` seconds: input, every behaviour, coroutines, physics. */
  step(frames?: number, dt?: number): void;
  /** Step until `condition` is true, at most `maxFrames`: whether it came true. */
  until(condition: () => boolean, maxFrames?: number, dt?: number): boolean;
  /** Hold a key down, as the keyboard would, until `keyUp`. */
  keyDown(key: KeyCode): void;
  keyUp(key: KeyCode): void;
  /** Hold a key for `frames` frames, then let it go and step one more. */
  press(key: KeyCode, frames?: number): void;
  /** Press and lift at a point, a frame each — or press a page's `data-button` by its name. */
  click(target: ScreenPoint | string): void;
  /** Press at a point, as the mouse or a finger would, until `pointerUp`. */
  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;
  /** Press at `from`, drag to `to` over `frames` frames, lift. */
  swipe(from: ScreenPoint, to: ScreenPoint, frames?: number): void;
  /** Where a world position is on the screen, in pixels: where to aim a pointer. */
  worldToScreen(position: Vector3): ScreenPoint;
  /** Stop it: every behaviour is destroyed, `onDestroy` runs, and input is let go. */
  dispose(): void;
}

/**
 * Run a scene without drawing it — for a test, in Node or jsdom: `const game = simulate(Main)`, then
 * `game.press(KeyCode.Space)`, `game.until(() => findObjectOfType(GameState)!.phase === 'over')`.
 * The scene is built and behaviours run exactly as under `play`, on frames of a fixed `dt`, so a
 * test of the game's rules gives the same answer every run. One game runs at a time.
 */
export function simulate(build: () => unknown, options: SimulateOptions = {}): Simulation {
  const restorePage = options.page === undefined ? null : showPage(options.page);
  const scene = new Scene();
  const runtime = new Runtime(scene, { fixedDelta: options.fixedDelta });
  let camera: RenderCamera | null = null;
  provideCamera(runtime, () => camera);
  const screen: ScreenPoint = [Screen.width, Screen.height];
  if (options.size) setScreenSize(...options.size);
  attachWorld(scene, () => {
    camera = sceneCamera(scene);
    if (camera) fitCamera(camera, Screen.width, Screen.height);
  });
  // Whatever a previous game or test left held would be pressed in this one.
  Input.clear();
  loadInto(scene, build, false);

  const frame = (dt: number) => {
    Input.advance(Math.min(Math.max(dt, 0), runtime.maxDelta));
    runtime.update(dt);
    Input.endFrame();
  };
  let disposed = false;
  const game: Simulation = {
    scene,
    get camera() {
      return camera;
    },
    runtime,
    step(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) frame(dt);
    },
    until(condition, maxFrames = 600, dt = 1 / 60) {
      for (let i = 0; i < maxFrames; i++) {
        if (condition()) return true;
        frame(dt);
      }
      if (condition()) return true;
      // Easy to miss when the result is not asserted: a game whose rounds outgrew the default.
      console.warn(`simulate: until(${condition.toString().replace(/\s+/g, ' ')}) was still false after ${maxFrames} frames. Pass more: until(condition, ${maxFrames * 4}).`);
      return false;
    },
    keyDown: (key) => Input.key(key, true),
    keyUp: (key) => Input.key(key, false),
    press(key, frames = 6) {
      Input.key(key, true);
      game.step(frames);
      Input.key(key, false);
      game.step();
    },
    click(target) {
      if (typeof target === 'string') {
        if (restorePage && !document.querySelector(`[data-button="${target.replace(/["\\]/g, '\\$&')}"]`)) {
          const names = [...document.querySelectorAll('[data-button]')].map((b) => b.getAttribute('data-button'));
          throw new Error(`click: the page has no data-button called "${target}". It has: ${names.join(', ') || 'none'}.`);
        }
        Input.pageButton(target);
        game.step();
        return;
      }
      game.pointerDown(...target);
      game.step();
      game.pointerUp();
      game.step();
    },
    pointerDown: (x, y) => Input.pointerDown(x, y, Screen.width, Screen.height, MouseButton.Left),
    pointerMove: (x, y) => Input.pointerMove(x, y, Screen.width, Screen.height),
    pointerUp: () => Input.pointerUp(MouseButton.Left),
    swipe(from, to, frames = 8) {
      game.pointerDown(...from);
      for (let i = 1; i <= frames; i++) {
        game.pointerMove(from[0] + ((to[0] - from[0]) * i) / frames, from[1] + ((to[1] - from[1]) * i) / frames);
        game.step();
      }
      game.pointerUp();
      game.step();
    },
    worldToScreen(position) {
      if (!camera) throw new Error('worldToScreen: the scene has no camera to see it from. Put one in it: <PerspectiveCamera position={[0, 2, 6]} />');
      camera.updateMatrixWorld();
      const p = position.clone().project(camera);
      return [((p.x + 1) / 2) * Screen.width, ((1 - p.y) / 2) * Screen.height];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const child of [...scene.children]) destroy(child);
      flushDestroyed();
      runtime.dispose();
      detachWorld(scene);
      setScreenSize(...screen);
      Input.clear();
      restorePage?.();
    },
  };
  return game;
}

/** The page's body, without its scripts, as the document's: and how to put the last one back. */
function showPage(page: string): () => void {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    throw new Error("simulate: a page needs a document. Run the test in jsdom: test: { environment: 'jsdom' } in vite.config.ts.");
  }
  const parsed = new DOMParser().parseFromString(page, 'text/html');
  for (const script of parsed.querySelectorAll('script')) script.remove();
  const before = document.body.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  return () => {
    document.body.innerHTML = before;
  };
}
