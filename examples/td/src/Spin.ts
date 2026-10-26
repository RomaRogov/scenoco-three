import { Behaviour } from '@scenoco-three/core';

/** Turns and bobs its node: the stars over an upgraded tower. */
export class Spin extends Behaviour {
  speed = 1.5;
  bob = 0.08;

  private time = Math.random() * 10;
  private base = 0;

  override start() {
    this.base = this.node.position.y;
  }

  override update(dt: number) {
    this.time += dt;
    this.node.rotation.y += this.speed * dt;
    this.node.position.y = this.base + Math.sin(this.time * 2.4) * this.bob;
  }
}
