import { SphereGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({ name: 'SphereGeometry', target: GEOMETRY_TARGETS, group: 'geometry', required: true })
export class SphereGeometryNode extends Attachment<Mesh> {
  @property({ type: 'float', default: 1 }) radius = 1;
  @property({ type: 'int', default: 32 }) widthSegments = 32;
  @property({ type: 'int', default: 16 }) heightSegments = 16;

  private cached?: SphereGeometry;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.geometry = (this.cached ??= new SphereGeometry(this.radius, this.widthSegments, this.heightSegments));
  }
}
