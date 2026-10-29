import { Vector3, type Object3D } from 'three';
import { Behaviour } from '@scenoco-three/core';

/** Turns its node, in degrees per second about each axis: a gem, a pickup's sign. */
export class Spin extends Behaviour<Object3D> {
  speed = new Vector3(0, 90, 0);

  override update(dt: number): void {
    const k = (Math.PI / 180) * dt;
    this.node.rotation.x += this.speed.x * k;
    this.node.rotation.y += this.speed.y * k;
    this.node.rotation.z += this.speed.z * k;
  }
}
