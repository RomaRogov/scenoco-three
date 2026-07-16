import { Color, type Scene } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({ name: 'Background', target: 'Scene', group: 'background', description: 'Solid background color for the scene' })
export class BackgroundAttachment extends Attachment<Scene> {
  @property({ type: ValueType.Color, default: 0xffffff, description: 'Background color' }) color = 0xffffff;

  attach(ctx: AttachContext<Scene>): void {
    ctx.node.background = new Color(this.color);
  }
}
