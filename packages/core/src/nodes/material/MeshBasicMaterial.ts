import { MeshBasicMaterial, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({ name: 'MeshBasicMaterial', target: MATERIAL_TARGETS, group: 'material' })
export class MeshBasicMaterialNode extends Attachment<Mesh> {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;
  @property({ type: 'float', default: 1 }) opacity = 1;
  @property({ type: 'bool', default: false }) transparent = false;
  @property({ type: 'bool', default: false }) wireframe = false;

  private cached?: MeshBasicMaterial;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.material = (this.cached ??= new MeshBasicMaterial({
      color: this.color,
      opacity: this.opacity,
      transparent: this.transparent,
      wireframe: this.wireframe,
    }));
  }
}
