import { MathUtils, type PerspectiveCamera } from 'three';
import { Behaviour } from '@scenoco-three/core';

/**
 * Keeps the width of the view a screen of `aspect` sees: on a narrower one — a tall phone — the
 * vertical field of view opens up instead of the slope's sides falling off the screen. A wider screen
 * keeps the camera's own fov, as Unity's camera does.
 */
export class FitWidth extends Behaviour<PerspectiveCamera> {
  /** The narrowest shape the view was made for, width over height: the game's 9:16 portrait. */
  aspect = 9 / 16;

  private fov = 0;
  private seen = 0;

  override awake(): void {
    this.fov = this.node.fov;
  }

  /** Every frame, because the window can change shape without a resize event reaching us. */
  override lateUpdate(): void {
    const camera = this.node;
    if (camera.aspect === this.seen) return;
    this.seen = camera.aspect;
    // The horizontal half-angle `aspect` gives, held as the screen narrows past it.
    const halfWidth = Math.tan((this.fov / 2) * MathUtils.DEG2RAD) * this.aspect;
    camera.fov = camera.aspect >= this.aspect ? this.fov : 2 * Math.atan(halfWidth / camera.aspect) * MathUtils.RAD2DEG;
    camera.updateProjectionMatrix();
  }
}
