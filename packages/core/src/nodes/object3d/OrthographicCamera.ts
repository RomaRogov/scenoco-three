import { OrthographicCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

@node({ name: 'OrthographicCamera', description: 'Orthographic-projection camera' })
export class OrthographicCameraNode extends Object3DNode {
  @property({ type: 'float', default: -1 }) left = -1;
  @property({ type: 'float', default: 1 }) right = 1;
  @property({ type: 'float', default: 1 }) top = 1;
  @property({ type: 'float', default: -1 }) bottom = -1;
  @property({ type: 'float', default: 0.1 }) near = 0.1;
  @property({ type: 'float', default: 2000 }) far = 2000;

  build(): OrthographicCamera {
    return new OrthographicCamera(this.left, this.right, this.top, this.bottom, this.near, this.far);
  }
}
