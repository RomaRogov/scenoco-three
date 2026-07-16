import { PointsMaterial, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({
  name: 'PointsMaterial',
  description: 'Material for point clouds (<Points>) — colored, sized dots.',
  target: MATERIAL_TARGETS,
  group: 'material',
})
export class PointsMaterialNode extends Attachment<Mesh> {
  @property({ type: ValueType.Color, default: 0xffffff, description: 'Point color' }) color = 0xffffff;
  @property({ type: ValueType.Float, default: 1, description: 'Point size in world units (or pixels if no attenuation)' }) size = 1;
  @property({ type: ValueType.Bool, default: true, description: 'Scale point size with distance (perspective)' }) sizeAttenuation = true;
  @property({ type: ValueType.Float, default: 1, description: 'Opacity, 0 (transparent) to 1 (opaque)' }) opacity = 1;
  @property({ type: ValueType.Bool, default: false, description: 'Enable alpha blending (use with opacity)' }) transparent = false;

  private cached?: PointsMaterial;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.material = (this.cached ??= new PointsMaterial({
      color: this.color,
      size: this.size,
      sizeAttenuation: this.sizeAttenuation,
      opacity: this.opacity,
      transparent: this.transparent,
    }));
  }
}
