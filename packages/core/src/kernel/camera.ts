import type { OrthographicCamera, PerspectiveCamera } from 'three';
import type { Runtime } from './runtime.js';

/** The camera a scene is drawn with: the one the scene put in, perspective or orthographic. */
export type RenderCamera = PerspectiveCamera | OrthographicCamera;

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
