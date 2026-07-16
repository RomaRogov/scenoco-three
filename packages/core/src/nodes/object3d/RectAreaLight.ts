import { RectAreaLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

@node({ name: 'RectAreaLight', description: 'Uniform light across a rectangle (works with MeshStandardMaterial)' })
export class RectAreaLightNode extends Object3DNode {
  @property({ type: ValueType.Color, default: 0xffffff, description: 'Light color' }) color = 0xffffff;
  @property({ type: ValueType.Float, default: 1, description: 'Light intensity' }) intensity = 1;
  @property({ type: ValueType.Float, default: 10, description: 'Width of the emitting rectangle' }) width = 10;
  @property({ type: ValueType.Float, default: 10, description: 'Height of the emitting rectangle' }) height = 10;

  build(): RectAreaLight {
    return new RectAreaLight(this.color, this.intensity, this.width, this.height);
  }
}
