import { AmbientLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

@node({ name: 'AmbientLight', description: 'Light that affects all objects equally' })
export class AmbientLightNode extends Object3DNode {
  @property({ type: 'color', default: 0xffffff, description: 'Light color' }) color = 0xffffff;
  @property({ type: 'float', default: 1, description: 'Light intensity' }) intensity = 1;

  build(): AmbientLight {
    return new AmbientLight(this.color, this.intensity);
  }
}
