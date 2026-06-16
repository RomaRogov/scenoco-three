import { PlaneGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({ name: 'PlaneGeometry', target: GEOMETRY_TARGETS, group: 'geometry', required: true })
export class PlaneGeometryNode extends Attachment<Mesh> {
  @property({ type: 'float', default: 1 }) width = 1;
  @property({ type: 'float', default: 1 }) height = 1;
  @property({ type: 'int', default: 1 }) widthSegments = 1;
  @property({ type: 'int', default: 1 }) heightSegments = 1;

  private cached?: PlaneGeometry;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.geometry = (this.cached ??= new PlaneGeometry(
      this.width,
      this.height,
      this.widthSegments,
      this.heightSegments,
    ));
  }
}
