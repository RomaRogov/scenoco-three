import { Vector3 } from 'three';
import { Component, component, property } from '@scenoco-three/core';
import { Oscillator } from './Oscillator.js';

/**
 * Moves the host along an axis by another Oscillator's current offset —
 * a typed component-to-component reference (Unity/Cocos style).
 */
@component({ name: 'Follow', description: "Offsets the host along an axis by another Oscillator's value" })
export class Follow extends Component {
  @property(Oscillator)
  source: Oscillator | null = null;

  @property({ type: 'vec3', default: '0 1 0', description: 'Direction the offset is applied along' })
  axis = new Vector3(0, 1, 0);

  @property({ type: 'float', default: 1, description: 'Multiplier on the source offset' })
  scale = 1;

  private readonly origin = new Vector3();

  override onLoad(): void {
    this.origin.copy(this.node.position);
  }

  override update(): void {
    if (!this.source) return;
    this.node.position.copy(this.origin).addScaledVector(this.axis, this.source.offset * this.scale);
  }
}
