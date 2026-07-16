import { Object3D, Vector3 } from 'three';
import { Component, component, property, ValueType } from '@scenoco-three/core';
import { Oscillator } from './Oscillator.js';

/**
 * Fixture component exercising every array property element type:
 * float[], vec3[], node[], typed-component[], prefab[].
 */
@component({ name: 'ArrayProbe', description: 'Tests array-typed properties' })
export class ArrayProbe extends Component {
  @property({ type: [ValueType.Float], default: [], description: 'Float array' })
  points: number[] = [];

  @property({ type: [ValueType.Vec3], default: [], description: 'Vec3 array' })
  waypoints: Vector3[] = [];

  @property({ type: [ValueType.Node], description: 'Node-reference array' })
  targets: Object3D[] = [];

  @property({ type: [Oscillator], description: 'Typed-component-reference array' })
  oscillators: Oscillator[] = [];

  @property({ type: [ValueType.String], description: 'String array' })
  labels: string[] = [];
}
