import { PerspectiveCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

@node({ name: 'PerspectiveCamera', description: 'Perspective-projection camera' })
export class PerspectiveCameraNode extends Object3DNode {
  @property({ type: 'float', default: 50 }) fov = 50;
  @property({ type: 'float', default: 0.1 }) near = 0.1;
  @property({ type: 'float', default: 2000 }) far = 2000;

  // Aspect is set by the engine to match the canvas.
  build(): PerspectiveCamera {
    return new PerspectiveCamera(this.fov, 1, this.near, this.far);
  }
}
