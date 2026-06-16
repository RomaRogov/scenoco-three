import { Component, component, property } from '@scenoco-three/core';

@component({ name: 'Rotator', description: 'Rotates the host node around its Y axis over time' })
export class Rotator extends Component {
  @property({ type: 'float', default: 1, description: 'Rotation speed in radians per second' })
  speed = 1;

  override update(dt: number): void {
    this.node.rotation.y += this.speed * dt;
  }
}
