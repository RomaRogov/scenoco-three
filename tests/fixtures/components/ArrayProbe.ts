import { Object3D, Vector3 } from 'three';
import { Component, component, property } from '@scenoco-three/core';
import { Oscillator } from './Oscillator.js';

/**
 * Fixture component exercising every array property element type:
 * float[], vec3[], node[], typed-component[], prefab[].
 */
@component({ name: 'ArrayProbe', description: 'Tests array-typed properties' })
export class ArrayProbe extends Component {
  @property({ type: ['float'], default: [] })
  points: number[] = [];

  @property({ type: ['vec3'], default: [] })
  waypoints: Vector3[] = [];

  @property({ type: ['node'] })
  targets: Object3D[] = [];

  @property({ type: [Oscillator] })
  oscillators: Oscillator[] = [];

  @property({ type: ['string'] })
  labels: string[] = [];
}
