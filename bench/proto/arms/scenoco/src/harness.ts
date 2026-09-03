import { SceneManager, Time } from '@scenoco-three/core';
import type { Scene } from 'three';
import { MainScene } from '../assets/scenes/main.scene.gen.js';

/**
 * The benchmark seam. Declared locally rather than imported — this is a standalone project — and
 * checked structurally where the oracle assigns it.
 *
 * Do not change this file: it is the contract every stack is read through.
 */
export interface Sketch {
  scene: Scene;
  step(dt: number): void;
  dispose(): void;
}

/**
 * Build the scene with no renderer and no engine, driven a frame at a time.
 *
 * There is no `Engine` here on purpose: it owns a `WebGLRenderer`, and the oracle asserts on the
 * scene graph rather than on pixels. `SceneManager.tick` is the same call `Engine` makes from its
 * frame loop, so what runs is the prototype, not a test double of it.
 */
export async function createSketch(): Promise<Sketch> {
  Time.reset();
  Time.timeScale = 1;
  Time.fixedDeltaTime = 1 / 50;
  SceneManager.resetFrameClock();

  const scene = await SceneManager.load(MainScene);

  // A synthetic clock: `tick` takes a timestamp, so stepping means advancing one.
  let now = 0;

  return {
    scene,
    step(dt) {
      now += dt * 1000;
      SceneManager.tick(now);
    },
    dispose() {
      void SceneManager.unloadAll();
    },
  };
}
