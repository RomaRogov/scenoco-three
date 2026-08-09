import { OrthographicCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';
import { enumOf } from '../../registry/EnumRegistry.js';
import { CAMERA_FIT_MODES, type CameraFitConfig, type CameraFitModeName } from '../../runtime/cameraFit.js';

/** See `CameraFitModeName` in runtime/cameraFit.ts for what each mode does. */
const CameraFit = enumOf('CameraFit', [...CAMERA_FIT_MODES]);

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
   * correctly, on any canvas aspect ratio. `contain` — the default — keeps that
   * whole region on screen and letterboxes rather than cropping; `none` leaves
   * `left`/`right`/`top`/`bottom` exactly as authored. When active, this **owns**
   * those four (they're recomputed every resize; whatever static values are
   * authored on the node become irrelevant), centered on the origin — position
   * the camera itself wherever the design region's center should be.
   *
   * Unlike a perspective camera these are literal world units, so 16×9 is a
   * starting point to overwrite, not a neutral one: it is non-zero because
   * `applyCameraFit` reads a zero dimension as "not configured" and returns,
   * which would make `fit="contain"` silently frame like `none`.
   */
  @property({ type: CameraFit, required: true, description: "Auto-adjust left/right/top/bottom to a designWidth/designHeight region as the canvas resizes ('none' = off, static frustum)" })
  fit: CameraFitModeName = 'contain';
  @property({ type: ValueType.Float, description: 'Reference width (world units) for `fit`' })
  designWidth = 16;
  @property({ type: ValueType.Float, description: 'Reference height (world units) for `fit`' })
  designHeight = 9;

  build(): OrthographicCamera {
    const camera = new OrthographicCamera(this.left, this.right, this.top, this.bottom, this.near, this.far);
    camera.userData.priority = this.priority;
    camera.userData.fit = { mode: this.fit, designWidth: this.designWidth, designHeight: this.designHeight } satisfies CameraFitConfig;
    return camera;
  }
}
