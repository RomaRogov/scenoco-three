import { MeshStandardMaterial, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({ name: 'MeshStandardMaterial', target: MATERIAL_TARGETS, group: 'material' })
export class MeshStandardMaterialNode extends Attachment<Mesh> {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;
  @property({ type: 'float', default: 1 }) roughness = 1;
  @property({ type: 'float', default: 0 }) metalness = 0;
  @property({ type: 'color', default: 0x000000 }) emissive = 0x000000;
  @property({ type: 'float', default: 1 }) opacity = 1;
  @property({ type: 'bool', default: false }) transparent = false;
  @property({ type: 'bool', default: false }) wireframe = false;

  private cached?: MeshStandardMaterial;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.material = (this.cached ??= new MeshStandardMaterial({
      color: this.color,
      roughness: this.roughness,
      metalness: this.metalness,
      emissive: this.emissive,
      opacity: this.opacity,
      transparent: this.transparent,
      wireframe: this.wireframe,
    }));
  }
}
