import { PerspectiveCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

@node({ name: 'PerspectiveCamera', description: 'Perspective-projection camera' })
export class PerspectiveCameraNode extends Object3DNode {
  @property({ type: ValueType.Float, description: 'Vertical field of view in degrees' }) fov = 50;
  @property({ type: ValueType.Float, description: 'Near clipping plane distance' }) near = 0.1;
  @property({ type: ValueType.Float, description: 'Far clipping plane distance' }) far = 2000;
  @property({ type: ValueType.Float, description: 'Render order (Unity camera depth): higher renders later, on top' })
  priority = 0;

  // Aspect is set by the engine to match the canvas.
  build(): PerspectiveCamera {
    const camera = new PerspectiveCamera(this.fov, 1, this.near, this.far);
    camera.userData.priority = this.priority;
    return camera;
  }
}
