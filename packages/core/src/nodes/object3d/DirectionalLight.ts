import { DirectionalLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

@node({
  name: 'DirectionalLight',
  description: 'Distant light emitting parallel rays from its position toward the origin',
})
export class DirectionalLightNode extends Object3DNode {
  @property({ type: ValueType.Color, default: 0xffffff, description: 'Light color' }) color = 0xffffff;
  @property({ type: ValueType.Float, default: 1, description: 'Light intensity' }) intensity = 1;

  build(): DirectionalLight {
    return new DirectionalLight(this.color, this.intensity);
  }
}
