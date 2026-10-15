import { MathUtils, type PerspectiveCamera } from 'three';
import { Behaviour } from '@scenoco-three/core';

/**
 * Keeps a `width` × `height` frame of the world on screen whatever shape the window is: the fov is
 * derived from the window's shape, so a narrow phone letterboxes instead of cropping the side walls.
 */
export class CameraFit extends Behaviour<PerspectiveCamera> {
  /** The frame, in world units. */
  width = 20;
  height = 20;
  /** How far in front of the camera the frame sits. */
  distance = 20;

  private aspect = 0;

  /** Every frame, because the window can change shape without a resize event reaching us. */
  override lateUpdate(): void {
    const camera = this.node;
    if (camera.aspect === this.aspect) return;
    this.aspect = camera.aspect;
    // Show the whole frame: the taller of what the width and the height each need.
    const visible = Math.max(this.height, this.width / camera.aspect);
    camera.fov = 2 * Math.atan(visible / 2 / this.distance) * MathUtils.RAD2DEG;
    camera.updateProjectionMatrix();
  }
}
