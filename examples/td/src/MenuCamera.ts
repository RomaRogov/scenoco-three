import type { PerspectiveCamera } from 'three';
import { Behaviour } from '@scenoco-three/core';

/** The title screen's camera: a slow circle high over the first map. */
export class MenuCamera extends Behaviour<PerspectiveCamera> {
  radius = 26;
  height = 22;
  speed = 0.05;
  lookY = 1;

  private angle = 0.6;

  override update(dt: number) {
    this.angle += this.speed * dt;
    this.node.position.set(Math.sin(this.angle) * this.radius, this.height, Math.cos(this.angle) * this.radius);
    this.node.lookAt(0, this.lookY, 0);
  }
}
