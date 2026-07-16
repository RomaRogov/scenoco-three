import { PointLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

@node({ name: 'PointLight', description: 'Omnidirectional light emitted from a single point' })
export class PointLightNode extends Object3DNode {
  @property({ type: ValueType.Color, description: 'Light color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Light intensity (candela)' }) intensity = 1;
  @property({ type: ValueType.Float, description: 'Range; 0 = infinite' }) distance = 0;
  @property({ type: ValueType.Float, description: 'Falloff exponent with distance' }) decay = 2;

  build(): PointLight {
    return new PointLight(this.color, this.intensity, this.distance, this.decay);
  }
}
