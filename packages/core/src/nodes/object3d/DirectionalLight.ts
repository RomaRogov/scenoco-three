import { DirectionalLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

@node({
  name: 'DirectionalLight',
  description: 'Distant light emitting parallel rays from its position toward the origin',
})
export class DirectionalLightNode extends Object3DNode {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;
  @property({ type: 'float', default: 1 }) intensity = 1;

  build(): DirectionalLight {
    return new DirectionalLight(this.color, this.intensity);
  }
}
