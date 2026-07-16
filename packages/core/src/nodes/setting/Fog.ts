import { Fog, type Scene } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({ name: 'Fog', target: 'Scene', group: 'fog', description: 'Linear fog that fades distant objects between near and far' })
export class FogAttachment extends Attachment<Scene> {
  @property({ type: ValueType.Color, description: 'Fog color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Distance at which fog starts' }) near = 1;
  @property({ type: ValueType.Float, description: 'Distance at which fog fully obscures' }) far = 1000;

  attach(ctx: AttachContext<Scene>): void {
    ctx.node.fog = new Fog(this.color, this.near, this.far);
  }
}
