import type { Object3D } from 'three';
import { Behaviour } from '@scenoco-three/core';

/** Idle motion: bobs and turns. A behaviour with plain number fields. */
export class Bob extends Behaviour {
  height = 0.15;
  speed = 1.5;
  spin = 0.4;

  private baseY = 0;

  override awake() {
    this.baseY = this.node.position.y;
  }

  override update(dt: number) {
    this.node.position.y = this.baseY + Math.sin(Date.now() * this.speed) * this.height;
    this.node.rotation.y += this.spin * dt;
  }
}

/** A behaviour linked to another node: what a ref fills. */
export class Spawner extends Behaviour {
  cloud: Object3D | null = null;
  interval = 0.7;
}
