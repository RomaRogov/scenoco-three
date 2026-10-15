import { Vector3, type Object3D } from 'three';
import { Behaviour } from '@scenoco-three/core';

/** Keeps its node — the camera — at an offset from a target, looking at it. */
export class Follow extends Behaviour {
  target: Object3D | null = null;
  offset = new Vector3(0, 5, 8);

  lateUpdate() {
    if (!this.target) return;
    this.node.position.copy(this.target.position).add(this.offset);
    this.node.lookAt(this.target.position);
  }
}
