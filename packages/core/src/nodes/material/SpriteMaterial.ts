import { SpriteMaterial, type Sprite } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({
  name: 'SpriteMaterial',
  description: 'Material for a <Sprite> — a camera-facing textured quad.',
  target: MATERIAL_TARGETS,
  group: 'material',
})
export class SpriteMaterialNode extends Attachment<Sprite> {
  @property({ type: ValueType.Color, description: 'Sprite tint color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Rotation of the sprite in radians' }) rotation = 0;
  @property({ type: ValueType.Float, description: 'Opacity, 0 (transparent) to 1 (opaque)' }) opacity = 1;
  @property({ type: ValueType.Bool, description: 'Enable alpha blending (use with opacity)' }) transparent = false;

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
