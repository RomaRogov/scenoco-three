import { LineBasicMaterial, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({
  name: 'LineBasicMaterial',
  description: 'Material for line geometry (<Line>/<LineSegments>).',
  target: MATERIAL_TARGETS,
  group: 'material',
})
export class LineBasicMaterialNode extends Attachment<Mesh> {
  @property({ type: 'color', default: 0xffffff, description: 'Line color' }) color = 0xffffff;
  @property({ type: 'float', default: 1, description: 'Line width (most platforms render 1px regardless)' }) linewidth = 1;
  @property({ type: 'float', default: 1, description: 'Opacity, 0 (transparent) to 1 (opaque)' }) opacity = 1;
  @property({ type: 'bool', default: false, description: 'Enable alpha blending (use with opacity)' }) transparent = false;

  private cached?: LineBasicMaterial;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.material = (this.cached ??= new LineBasicMaterial({
      color: this.color,
      linewidth: this.linewidth,
      opacity: this.opacity,
      transparent: this.transparent,
    }));
  }
}
