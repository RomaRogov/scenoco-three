import { Vector3, type Object3D } from 'three';
import { Behaviour } from '@scenoco-three/core';

/** Keeps the camera behind and above its target, easing after it, looking at it — after it has moved, in `lateUpdate`. */
export class FollowCamera extends Behaviour {
  target: Object3D | null = null;
  offset = new Vector3(0, 7, 10);
  /** How quickly it catches up: higher is tighter. */
  sharpness = 5;

  private readonly wanted = new Vector3();

  override lateUpdate(dt: number) {
    if (!this.target) return;
    this.wanted.copy(this.target.position).add(this.offset);
    this.node.position.lerp(this.wanted, 1 - Math.exp(-this.sharpness * dt));
    this.node.lookAt(this.target.position);
  }
}
