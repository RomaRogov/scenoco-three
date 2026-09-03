import type { Scene } from 'three';
import { Prototype } from './scene.js';

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

export function createSketch(): Promise<Sketch> {
  const prototype = new Prototype();
  return Promise.resolve({
    scene: prototype.scene,
    step: (dt) => prototype.step(dt),
    dispose: () => prototype.dispose(),
  });
}
