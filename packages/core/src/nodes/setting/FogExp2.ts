import { FogExp2, type Scene } from 'three';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { FogAttachment } from '../families.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

// Shares group 'fog' with <Fog>, so a scene can declare at most one of them.
@attachment({ name: 'FogExp2', description: 'Exponential-squared fog (denser, distance-based)' })
export class FogExp2Node extends FogAttachment {
  @property({ type: ValueType.Color, description: 'Fog color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Fog density (higher = thicker)' }) density = 0.00025;

  attach(ctx: AttachContext<Scene>): void {
    ctx.node.fog = new FogExp2(this.color, this.density);
  }
}
