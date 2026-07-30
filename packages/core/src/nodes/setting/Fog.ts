import { Fog, type Scene } from 'three';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { FogAttachment } from '../families.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({ name: 'Fog', description: 'Linear fog that fades distant objects between near and far' })
export class FogNode extends FogAttachment {
  @property({ type: ValueType.Color, description: 'Fog color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Distance at which fog starts' }) near = 1;
  @property({ type: ValueType.Float, description: 'Distance at which fog fully obscures' }) far = 1000;

  attach(ctx: AttachContext<Scene>): void {
    ctx.node.fog = new Fog(this.color, this.near, this.far);
  }
}
