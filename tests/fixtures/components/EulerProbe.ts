import { Euler } from 'three';
import { Component, component, property, ValueType } from '@scenoco-three/core';

@component({ name: 'EulerProbe', description: 'Holds a Euler property, for unit-conversion coverage' })
export class EulerProbe extends Component {
  @property({ type: ValueType.Euler, description: 'Authored in degrees; held at runtime as a radians Euler' })
  tilt = new Euler();
}
