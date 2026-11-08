import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { Behaviour } from '@scenoco-three/core';

/**
 * Keeps its node — the camera — at an offset from a target, looking at it, and far enough back that
 * `width` world units fit across the screen: a camera keeps its height, so held upright it backs off.
 */
export class Follow extends Behaviour<PerspectiveCamera> {
  target: Object3D | null = null;
  offset = new Vector3(0, 5, 8);
  width = 12;

  lateUpdate() {
    if (!this.target) return;
    const across = 2 * this.offset.length() * Math.tan((this.node.fov * Math.PI) / 360) * this.node.aspect;
    this.node.position.copy(this.target.position).addScaledVector(this.offset, Math.max(1, this.width / across));
    this.node.lookAt(this.target.position);
  }
}
