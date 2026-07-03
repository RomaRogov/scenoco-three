import { Component, component, property } from '@scenoco-three/core';

@component({ name: 'Enemy', description: 'An enemy marker component (test fixture).' })
export class Enemy extends Component {
  @property({ type: 'float', default: 1, description: 'Hit points' }) hp = 1;
}
