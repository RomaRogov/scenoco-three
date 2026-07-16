import { PlaneGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({
  name: 'PlaneGeometry',
  description: 'Flat plane geometry (in the XY plane) for a mesh.',
  target: GEOMETRY_TARGETS,
  group: 'geometry',
  required: true,
})
export class PlaneGeometryNode extends Attachment<Mesh> {
  @property({ type: ValueType.Float, default: 1, description: 'Size along X' }) width = 1;
  @property({ type: ValueType.Float, default: 1, description: 'Size along Y' }) height = 1;
  @property({ type: ValueType.Int, default: 1, description: 'Subdivisions along X' }) widthSegments = 1;
  @property({ type: ValueType.Int, default: 1, description: 'Subdivisions along Y' }) heightSegments = 1;

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
