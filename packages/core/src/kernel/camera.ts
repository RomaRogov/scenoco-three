import type { PerspectiveCamera } from 'three';
import type { Runtime } from './runtime.js';

/** The camera a scene is drawn with. A perspective camera unless the scene says otherwise. */
export type RenderCamera = PerspectiveCamera;

/** Per runtime: the camera it renders with now. Whatever drives the frame says. */
const cameras = new WeakMap<Runtime, () => RenderCamera | null>();

/** @internal */
export function provideCamera(runtime: Runtime, camera: () => RenderCamera | null): void {
  cameras.set(runtime, camera);
}

/** @internal */
export function cameraOf(runtime: Runtime | null): RenderCamera | null {
  return (runtime && cameras.get(runtime)?.()) ?? null;
}
