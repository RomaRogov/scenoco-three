import { advance } from '@react-three/fiber';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Scene } from 'three';
import { Sketch } from './Scene.js';

/**
 * The benchmark seam. Declared locally rather than imported — this is a standalone project — and
 * checked structurally where the oracle assigns it.
 *
 * Do not change this file: it is the contract every stack is read through.
 */
export interface Sketch_ {
  scene: Scene;
  step(dt: number): void;
  dispose(): void;
}
export type { Sketch_ as SketchSeam };

export async function createSketch(): Promise<Sketch_> {
  const renderer = await ReactThreeTestRenderer.create(<Sketch />, { frameloop: 'never' });
  let now = 0;

  return {
    scene: renderer.scene.instance as unknown as Scene,
    step(dt) {
      // `advance` takes a timestamp in *seconds* under `frameloop: 'never'`, so stepping means
      // carrying one forward rather than passing a delta.
      now += dt;
      advance(now);
    },
    dispose() {
      void renderer.unmount();
    },
  };
}
