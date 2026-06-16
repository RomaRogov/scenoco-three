import { TorusGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({ name: 'TorusGeometry', target: GEOMETRY_TARGETS, group: 'geometry', required: true })
export class TorusGeometryNode extends Attachment<Mesh> {
  @property({ type: 'float', default: 1 }) radius = 1;
  @property({ type: 'float', default: 0.4 }) tube = 0.4;
  @property({ type: 'int', default: 12 }) radialSegments = 12;
  @property({ type: 'int', default: 48 }) tubularSegments = 48;

  private cached?: TorusGeometry;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.geometry = (this.cached ??= new TorusGeometry(
      this.radius,
      this.tube,
      this.radialSegments,
      this.tubularSegments,
    ));
  }
}
