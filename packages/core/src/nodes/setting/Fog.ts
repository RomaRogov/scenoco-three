import { Fog, type Scene } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';

@attachment({ name: 'Fog', target: 'Scene', group: 'fog', description: 'Linear fog that fades distant objects between near and far' })
export class FogAttachment extends Attachment<Scene> {
  @property({ type: 'color', default: 0xffffff, description: 'Fog color' }) color = 0xffffff;
  @property({ type: 'float', default: 1, description: 'Distance at which fog starts' }) near = 1;
  @property({ type: 'float', default: 1000, description: 'Distance at which fog fully obscures' }) far = 1000;

  attach(ctx: AttachContext<Scene>): void {
    ctx.node.fog = new Fog(this.color, this.near, this.far);
  }
}
