import { PerspectiveCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

@node({ name: 'PerspectiveCamera', description: 'Perspective-projection camera' })
export class PerspectiveCameraNode extends Object3DNode {
  @property({ type: 'float', default: 50, description: 'Vertical field of view in degrees' }) fov = 50;
  @property({ type: 'float', default: 0.1, description: 'Near clipping plane distance' }) near = 0.1;
  @property({ type: 'float', default: 2000, description: 'Far clipping plane distance' }) far = 2000;
  @property({ type: 'float', default: 0, description: 'Render order (Unity camera depth): higher renders later, on top' })
  priority = 0;

  // Aspect is set by the engine to match the canvas.
  build(): PerspectiveCamera {
    const camera = new PerspectiveCamera(this.fov, 1, this.near, this.far);
    camera.userData.priority = this.priority;
    return camera;
  }
}
