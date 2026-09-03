import { Component } from '@scenoco-three/core';

/** Turns its node around Y. */
export class Spinner extends Component {
  /** Degrees per second. A public field is an attribute — nothing else declares it. */
  speed = 45;

  override update(dt: number): void {
    // `object3D` is the plain THREE.Object3D this component sits on, with all of three on it.
    this.object3D.rotation.y += (this.speed * Math.PI) / 180 * dt;
  }
}
