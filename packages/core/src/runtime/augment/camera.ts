/**
 * `screenToWorldPoint`: the one thing a camera is asked about the screen — Unity's
 * `Camera.ScreenToWorldPoint`.
 */
import { Camera, OrthographicCamera, Vector3 } from 'three';
import { Engine } from '../Engine.js';

declare module 'three' {
  interface Camera {
    /**
     * The world point under a screen position, `point.z` units in front of this camera —
     * Unity's `Camera.ScreenToWorldPoint`. `point.x, point.y` are the pixels `Input.mousePosition`
     * reports, from the canvas's top left.
     *
     * What a drag is made of. Pixels are not world units, and how many of one make the other
     * depends on the window, the fov and how far away the thing is — so a thing steered by
     * `mouseDelta` crawls on one screen and flies on another. Convert both ends of the move at the
     * depth of the thing being moved and take the difference:
     *
     * ```ts
     * camera.screenToWorldPoint(this.here.set(Input.mousePosition.x, Input.mousePosition.y, depth));
     * ```
     */
    screenToWorldPoint(point: Vector3, target?: Vector3): Vector3;
  }
}

const origin = new Vector3();
const forward = new Vector3();
const through = new Vector3();

Camera.prototype.screenToWorldPoint = function (this: Camera, point: Vector3, target = point): Vector3 {
  const canvas = Engine.current?.canvas;
  const width = canvas?.clientWidth ?? 0;
  const height = canvas?.clientHeight ?? 0;
  if (width <= 0 || height <= 0) {
    throw new Error(
      '[scenoco] screenToWorldPoint measures the screen, and there is none: no Engine is running, ' +
        'or its canvas has no size yet. Call it from update(), once the game is on screen.',
    );
  }
  this.updateWorldMatrix(true, false);
  this.getWorldPosition(origin);
  this.getWorldDirection(forward);
  // Read out first: `target` is `point` unless told otherwise.
  const x = (point.x / width) * 2 - 1;
  const y = -(point.y / height) * 2 + 1;
  const depth = point.z;

  if (this instanceof OrthographicCamera) {
    // Every ray is parallel: find it on the near plane and walk forward to the depth asked for.
    through.set(x, y, -1).unproject(this);
    return target.copy(through).addScaledVector(forward, depth - this.near);
  }
  // A perspective ray fans out, so `z` is a distance along the view axis, not along the ray.
  through.set(x, y, 0.5).unproject(this).sub(origin).normalize();
  const along = through.dot(forward);
  return target.copy(origin).addScaledVector(through, along > 0 ? depth / along : 0);
} as Camera['screenToWorldPoint'];
