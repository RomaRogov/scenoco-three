import { PointsMaterial, type Mesh } from 'three';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { MaterialAttachment } from '../families.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({
  name: 'PointsMaterial',
  description: 'Material for point clouds (<Points>) — colored, sized dots.',
})
export class PointsMaterialNode extends MaterialAttachment {
  @property({ type: ValueType.Color, description: 'Point color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Point size in world units (or pixels if no attenuation)' }) size = 1;
  @property({ type: ValueType.Bool, description: 'Scale point size with distance (perspective)' }) sizeAttenuation = true;
  @property({ type: ValueType.Float, description: 'Opacity, 0 (transparent) to 1 (opaque)' }) opacity = 1;
  @property({ type: ValueType.Bool, description: 'Enable alpha blending (use with opacity)' }) transparent = false;

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
