import { Component } from '@scenoco-three/core';
import type { Object3D } from 'three';
import type { Text } from '@scenoco-three/ui';

/** Counts floor bounces and writes them into a UI label. */
export class BounceCounter extends Component {
  /** The label to write into — filled in by the document with `#readout`. */
  readout!: Text;

  bounces = 0;

  override onCollisionEnter2D(other: Object3D): void {
    if (other.name !== 'ground') return;
    this.bounces++;
    this.readout.text = `bounces ${this.bounces}`;
  }
}
