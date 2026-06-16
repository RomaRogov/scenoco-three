import { SpriteMaterial, type Sprite } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({ name: 'SpriteMaterial', target: MATERIAL_TARGETS, group: 'material' })
export class SpriteMaterialNode extends Attachment<Sprite> {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;
  @property({ type: 'float', default: 0, description: 'Rotation of the sprite in radians' }) rotation = 0;
  @property({ type: 'float', default: 1 }) opacity = 1;
  @property({ type: 'bool', default: false }) transparent = false;

  private cached?: SpriteMaterial;
  attach(ctx: AttachContext<Sprite>): void {
    ctx.node.material = (this.cached ??= new SpriteMaterial({
      color: this.color,
      rotation: this.rotation,
      opacity: this.opacity,
      transparent: this.transparent,
    }));
  }
}
