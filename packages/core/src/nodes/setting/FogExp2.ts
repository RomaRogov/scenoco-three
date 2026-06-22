import { FogExp2, type Scene } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';

// Shares group 'fog' with <Fog>, so a scene can declare at most one of them.
@attachment({ name: 'FogExp2', target: 'Scene', group: 'fog', description: 'Exponential-squared fog (denser, distance-based)' })
export class FogExp2Attachment extends Attachment<Scene> {
  @property({ type: 'color', default: 0xffffff }) color = 0xffffff;
  @property({ type: 'float', default: 0.00025 }) density = 0.00025;

  attach(ctx: AttachContext<Scene>): void {
    ctx.node.fog = new FogExp2(this.color, this.density);
  }
}
