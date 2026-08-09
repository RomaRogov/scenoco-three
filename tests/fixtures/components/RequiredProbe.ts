import { Component, component, property, ValueType } from '@scenoco-three/core';

/** Fixture with a required `@property` (collider-style explicit sizing). */
@component({ name: 'RequiredProbe', description: 'Tests required properties' })
export class RequiredProbe extends Component {
  @property({ type: ValueType.Vec2, required: true, description: 'Explicit size — never inferred' })
  size = [1, 1];
}
