import { Color, type Scene } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';

@attachment({ name: 'Background', target: 'Scene', group: 'background', description: 'Solid background color for the scene' })
export class BackgroundAttachment extends Attachment<Scene> {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;

  attach(ctx: AttachContext<Scene>): void {
    ctx.node.background = new Color(this.color);
  }
}
