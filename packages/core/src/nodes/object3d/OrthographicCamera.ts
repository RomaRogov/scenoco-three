import { OrthographicCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

@node({ name: 'OrthographicCamera', description: 'Orthographic-projection camera' })
export class OrthographicCameraNode extends Object3DNode {
  @property({ type: ValueType.Float, default: -1, description: 'Left edge of the view frustum' }) left = -1;
  @property({ type: ValueType.Float, default: 1, description: 'Right edge of the view frustum' }) right = 1;
  @property({ type: ValueType.Float, default: 1, description: 'Top edge of the view frustum' }) top = 1;
  @property({ type: ValueType.Float, default: -1, description: 'Bottom edge of the view frustum' }) bottom = -1;
  @property({ type: ValueType.Float, default: 0.1, description: 'Near clipping plane distance' }) near = 0.1;
  @property({ type: ValueType.Float, default: 2000, description: 'Far clipping plane distance' }) far = 2000;
  @property({ type: ValueType.Float, default: 0, description: 'Render order (Unity camera depth): higher renders later, on top' })
  priority = 0;

  build(): OrthographicCamera {
    const camera = new OrthographicCamera(this.left, this.right, this.top, this.bottom, this.near, this.far);
    camera.userData.priority = this.priority;
    return camera;
  }
}
