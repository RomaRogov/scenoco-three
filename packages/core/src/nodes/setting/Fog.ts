import { Fog } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';

@attachment({ name: 'Fog', target: 'Scene', group: 'fog', description: 'Linear fog that fades distant objects between near and far' })
export class FogAttachment extends Attachment {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;
  @property({ type: 'float', default: 1 }) near = 1;
  @property({ type: 'float', default: 1000 }) far = 1000;

  attach(ctx: AttachContext): void {
    ctx.scene.fog = new Fog(this.color, this.near, this.far);
  }
}
