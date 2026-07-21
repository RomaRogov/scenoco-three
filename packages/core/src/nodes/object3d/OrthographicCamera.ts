import { OrthographicCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';
import { enumOf } from '../../registry/EnumRegistry.js';
import type { CameraFitConfig, CameraFitModeName } from '../../runtime/cameraFit.js';

/** See `CameraFitModeName` in runtime/cameraFit.ts for what each mode does. */
const CameraFit = enumOf('CameraFit', ['none', 'width', 'height', 'contain', 'cover']);

@node({ name: 'OrthographicCamera', description: 'Orthographic-projection camera' })
export class OrthographicCameraNode extends Object3DNode {
  @property({ type: ValueType.Float, description: 'Left edge of the view frustum' }) left = -1;
  @property({ type: ValueType.Float, description: 'Right edge of the view frustum' }) right = 1;
  @property({ type: ValueType.Float, description: 'Top edge of the view frustum' }) top = 1;
  @property({ type: ValueType.Float, description: 'Bottom edge of the view frustum' }) bottom = -1;
  @property({ type: ValueType.Float, description: 'Near clipping plane distance' }) near = 0.1;
  @property({ type: ValueType.Float, description: 'Far clipping plane distance' }) far = 2000;
  @property({ type: ValueType.Float, description: 'Render order (Unity camera depth): higher renders later, on top' })
  priority = 0;

  /**
   * Keep a `designWidth`×`designHeight` world-unit region always framed
   * correctly, on any canvas aspect ratio — `none` (default) leaves
   * `left`/`right`/`top`/`bottom` exactly as authored, unaffected. When active,
   * this **owns** those four (they're recomputed every resize; whatever static
   * values are authored on the node become irrelevant), centered on the origin —
   * position the camera itself wherever the design region's center should be.
   */
  @property({ type: CameraFit, description: "Auto-adjust left/right/top/bottom to a designWidth/designHeight region as the canvas resizes ('none' = off, static frustum)" })
  fit: CameraFitModeName = 'none';
  @property({ type: ValueType.Float, description: 'Reference width (world units) for `fit`' })
  designWidth = 0;
  @property({ type: ValueType.Float, description: 'Reference height (world units) for `fit`' })
  designHeight = 0;

  build(): OrthographicCamera {
    const camera = new OrthographicCamera(this.left, this.right, this.top, this.bottom, this.near, this.far);
    camera.userData.priority = this.priority;
    camera.userData.fit = { mode: this.fit, designWidth: this.designWidth, designHeight: this.designHeight } satisfies CameraFitConfig;
    return camera;
  }
}
