import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { Behaviour, Input, KeyCode } from '@scenoco-three/core';

/**
 * Follows `target` from behind and above, easing after it; C switches to a high view of the whole
 * track and back.
 */
export class ChaseCamera extends Behaviour<PerspectiveCamera> {
  target: Object3D | null = null;
  /** Where the camera sits, in the target's own axes: behind is -Z. */
  offset = new Vector3(0, 3.5, -9);
  /** How quickly it catches up, per second. */
  sharpness = 6;
  /** The high view's position, looking at the world's origin. */
  overview = new Vector3(0, 110, 45);

  private wide = false;
  private readonly wanted = new Vector3();
  private readonly look = new Vector3();

  override lateUpdate(dt: number): void {
    if (Input.getKeyDown(KeyCode.C)) this.wide = !this.wide;
    const target = this.target;
    if (!target) return;
    if (this.wide) {
      this.wanted.copy(this.overview);
      this.look.set(0, 0, -35);
    } else {
      target.updateWorldMatrix(true, false);
      target.localToWorld(this.wanted.copy(this.offset));
      target.localToWorld(this.look.set(0, 1, 4));
    }
    this.node.position.lerp(this.wanted, 1 - Math.exp(-this.sharpness * dt));
    this.node.lookAt(this.look);
  }
}
