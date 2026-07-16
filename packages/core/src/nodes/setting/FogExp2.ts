import { FogExp2, type Scene } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

// Shares group 'fog' with <Fog>, so a scene can declare at most one of them.
@attachment({ name: 'FogExp2', target: 'Scene', group: 'fog', description: 'Exponential-squared fog (denser, distance-based)' })
export class FogExp2Attachment extends Attachment<Scene> {
  @property({ type: ValueType.Color, default: 0xffffff, description: 'Fog color' }) color = 0xffffff;
  @property({ type: ValueType.Float, default: 0.00025, description: 'Fog density (higher = thicker)' }) density = 0.00025;

  attach(ctx: AttachContext<Scene>): void {
    ctx.node.fog = new FogExp2(this.color, this.density);
  }
}
