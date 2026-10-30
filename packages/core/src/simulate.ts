import { Scene } from 'three';
import { Runtime, destroy, provideCamera, type RenderCamera } from './kernel/index.js';
import { flushDestroyed } from './kernel/lifecycle.js';
import { Input } from './input/Input.js';
import type { KeyCode } from './input/KeyCode.js';
import { attachWorld, detachWorld, loadInto } from './scenes.js';
import { sceneCamera } from './play.js';

export interface SimulateOptions {
  /** Seconds per `fixedUpdate`. Unity's default, 0.02. */
  fixedDelta?: number;
}

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
  const scene = new Scene();
  const runtime = new Runtime(scene, { fixedDelta: options.fixedDelta });
  let camera: RenderCamera | null = null;
  provideCamera(runtime, () => camera);
  attachWorld(scene, () => (camera = sceneCamera(scene)));
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
      return condition();
    },
    keyDown: (key) => Input.key(key, true),
    keyUp: (key) => Input.key(key, false),
    press(key, frames = 6) {
      Input.key(key, true);
      game.step(frames);
      Input.key(key, false);
      game.step();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const child of [...scene.children]) destroy(child);
      flushDestroyed();
      runtime.dispose();
      detachWorld(scene);
      Input.clear();
    },
  };
  return game;
}
