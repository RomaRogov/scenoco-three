import { Vector3 } from 'three';
import { Component, component, property } from '@scenoco-three/core';

@component({
  name: 'Oscillator',
  description: 'Moves the host node back and forth along an axis as a sine wave',
})
export class Oscillator extends Component {
  @property({ type: 'vec3', default: '0 1 0', description: 'Movement axis in local space' })
  axis = new Vector3(0, 1, 0);

  @property({ type: 'float', default: 1, description: 'Peak offset distance from the start position' })
  amplitude = 1;

  @property({ type: 'float', default: 1, description: 'Oscillations per second' })
  frequency = 1;

  /** Current offset along the axis — read this via a typed reference. */
  offset = 0;

  private elapsed = 0;
  private readonly origin = new Vector3();

  override onLoad(): void {
    this.origin.copy(this.node.position);
  }

  override update(dt: number): void {
    this.elapsed += dt;
    this.offset = Math.sin(this.elapsed * this.frequency * Math.PI * 2) * this.amplitude;
    this.node.position.copy(this.origin).addScaledVector(this.axis, this.offset);
  }
}
