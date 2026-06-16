import { CylinderGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({ name: 'CylinderGeometry', target: GEOMETRY_TARGETS, group: 'geometry', required: true })
export class CylinderGeometryNode extends Attachment<Mesh> {
  @property({ type: 'float', default: 1 }) radiusTop = 1;
  @property({ type: 'float', default: 1 }) radiusBottom = 1;
  @property({ type: 'float', default: 1 }) height = 1;
  @property({ type: 'int', default: 32 }) radialSegments = 32;

  private cached?: CylinderGeometry;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.geometry = (this.cached ??= new CylinderGeometry(
      this.radiusTop,
      this.radiusBottom,
      this.height,
      this.radialSegments,
    ));
  }
}
