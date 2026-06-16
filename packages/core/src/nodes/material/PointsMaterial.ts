import { PointsMaterial, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({ name: 'PointsMaterial', target: MATERIAL_TARGETS, group: 'material' })
export class PointsMaterialNode extends Attachment<Mesh> {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;
  @property({ type: 'float', default: 1 }) size = 1;
  @property({ type: 'bool', default: true }) sizeAttenuation = true;
  @property({ type: 'float', default: 1 }) opacity = 1;
  @property({ type: 'bool', default: false }) transparent = false;

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
