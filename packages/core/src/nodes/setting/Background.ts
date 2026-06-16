import { Color } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';

@attachment({ name: 'Background', target: 'Scene', group: 'background', description: 'Solid background color for the scene' })
export class BackgroundAttachment extends Attachment {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;

  attach(ctx: AttachContext): void {
    ctx.scene.background = new Color(this.color);
  }
}
