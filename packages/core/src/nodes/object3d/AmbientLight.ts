import { AmbientLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

@node({ name: 'AmbientLight', description: 'Light that affects all objects equally' })
export class AmbientLightNode extends Object3DNode {
  @property({ type: ValueType.Color, description: 'Light color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Light intensity' }) intensity = 1;

  build(): AmbientLight {
    return new AmbientLight(this.color, this.intensity);
  }
}
