import { PerspectiveCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';
import { enumOf } from '../../registry/EnumRegistry.js';
import type { CameraFitConfig, CameraFitModeName } from '../../runtime/cameraFit.js';

/** See `CameraFitModeName` in runtime/cameraFit.ts for what each mode does. */
const CameraFit = enumOf('CameraFit', ['none', 'width', 'height', 'contain', 'cover']);

@node({ name: 'PerspectiveCamera', description: 'Perspective-projection camera' })
export class PerspectiveCameraNode extends Object3DNode {
  @property({ type: ValueType.Float, description: 'Vertical field of view in degrees' }) fov = 50;
  @property({ type: ValueType.Float, description: 'Near clipping plane distance' }) near = 0.1;
  @property({ type: ValueType.Float, description: 'Far clipping plane distance' }) far = 2000;
  @property({ type: ValueType.Float, description: 'Render order (Unity camera depth): higher renders later, on top' })
  priority = 0;

  /**
   * Keep a `designWidth`×`designHeight` region always framed correctly, on any
   * canvas aspect ratio (portrait phone, landscape desktop, …) — `none` (default)
   * leaves `fov` exactly as authored, unaffected. Only the *ratio* of
   * `designWidth`/`designHeight` matters for a perspective camera (framing is
   * scale-invariant with distance); `width`/`height`/`contain`/`cover` mirror
   * `<OrthographicCamera>`'s fit, which uses them as literal world units.
   */
  @property({ type: CameraFit, description: "Auto-adjust fov to a designWidth/designHeight aspect ratio as the canvas resizes ('none' = off, unchanged fov)" })
  fit: CameraFitModeName = 'none';
  @property({ type: ValueType.Float, description: 'Reference width for `fit` (only its ratio to designHeight matters)' })
  designWidth = 0;
  @property({ type: ValueType.Float, description: 'Reference height for `fit` (only its ratio to designWidth matters)' })
  designHeight = 0;

  // Aspect is set by the engine to match the canvas; so is the `fit` adjustment.
  build(): PerspectiveCamera {
    const camera = new PerspectiveCamera(this.fov, 1, this.near, this.far);
    camera.userData.priority = this.priority;
    camera.userData.baseFov = this.fov;
    camera.userData.fit = { mode: this.fit, designWidth: this.designWidth, designHeight: this.designHeight } satisfies CameraFitConfig;
    return camera;
  }
}
