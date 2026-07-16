import { Component, component, property, ValueType } from '@scenoco-three/core';

@component({ name: 'Enemy', description: 'An enemy marker component (test fixture).' })
export class Enemy extends Component {
  @property({ type: ValueType.Float, default: 1, description: 'Hit points' }) hp = 1;
}
