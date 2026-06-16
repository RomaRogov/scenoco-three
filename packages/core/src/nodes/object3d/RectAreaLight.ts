import { RectAreaLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

@node({ name: 'RectAreaLight', description: 'Uniform light across a rectangle (works with MeshStandardMaterial)' })
export class RectAreaLightNode extends Object3DNode {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;
  @property({ type: 'float', default: 1 }) intensity = 1;
  @property({ type: 'float', default: 10 }) width = 10;
  @property({ type: 'float', default: 10 }) height = 10;

  build(): RectAreaLight {
    return new RectAreaLight(this.color, this.intensity, this.width, this.height);
  }
}
