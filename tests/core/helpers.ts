import { Scene } from 'three';
import { SceneManager, Time, type SceneType } from '@scenoco-three/core';

/**
 * A throwaway scene class whose `onLoad` runs `build`.
 *
 * Scenes are keyed by their **class**, so a fresh class per test is what gives each case its
 * own scene identity in the manager — the same reason production code writes one class per
 * scene file rather than naming instances.
 */
export function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

/**
 * Drives `SceneManager.tick` off a synthetic clock instead of `performance.now()`, so every
 * lifecycle test is deterministic and needs no browser. Advance it by whole frames.
 */
export class Clock {
  private now = 0;

  /** Run one frame of `seconds`. */
  frame(seconds = 1 / 60): void {
    this.now += seconds * 1000;
    SceneManager.tick(this.now);
  }

  /** Run `count` frames of `seconds` each. */
  frames(count: number, seconds = 1 / 60): void {
    for (let i = 0; i < count; i++) this.frame(seconds);
  }
}

/** Reset the globals a test may have moved. Call from `afterEach`. */
export async function resetEngine(): Promise<void> {
  await SceneManager.unloadAll();
  SceneManager.resetFrameClock();
  Time.timeScale = 1;
  Time.fixedDeltaTime = 1 / 50;
  Time.reset();
}
