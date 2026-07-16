import { SpotLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

@node({ name: 'SpotLight', description: 'Cone of light emitted from a point in a direction' })
export class SpotLightNode extends Object3DNode {
  @property({ type: ValueType.Color, default: 0xffffff, description: 'Light color' }) color = 0xffffff;
  @property({ type: ValueType.Float, default: 1, description: 'Light intensity (candela)' }) intensity = 1;
  @property({ type: ValueType.Float, default: 0, description: 'Range; 0 = infinite' }) distance = 0;
  @property({ type: ValueType.Float, default: Math.PI / 3, description: 'Cone half-angle in radians (max PI/2)' })
  angle = Math.PI / 3;
  @property({ type: ValueType.Float, default: 0, description: 'Soft-edge fraction 0..1' }) penumbra = 0;
  @property({ type: ValueType.Float, default: 2, description: 'Falloff exponent with distance' }) decay = 2;

  build(): SpotLight {
    return new SpotLight(this.color, this.intensity, this.distance, this.angle, this.penumbra, this.decay);
  }
}
