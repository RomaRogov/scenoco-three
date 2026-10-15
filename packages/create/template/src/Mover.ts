import type { Mesh } from 'three';
import { Behaviour, Input } from '@scenoco-three/core';

/** Steers its node on the ground with the arrow keys or WASD — Unity's named axes. */
export class Mover extends Behaviour<Mesh> {
  speed = 4;

  update(dt: number) {
    this.node.position.x += Input.getAxis('Horizontal') * this.speed * dt;
    this.node.position.z -= Input.getAxis('Vertical') * this.speed * dt;
  }
}
