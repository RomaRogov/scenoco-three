import { Behaviour } from '@scenoco-three/core';

export class Coin extends Behaviour {
  spin = 3.2;

  update(dt: number) {
    this.node.rotation.y += this.spin * dt;
  }
}
