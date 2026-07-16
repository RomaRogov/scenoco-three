import { SphereGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({
  name: 'SphereGeometry',
  description: 'Sphere geometry for a mesh.',
  target: GEOMETRY_TARGETS,
  group: 'geometry',
  required: true,
})
export class SphereGeometryNode extends Attachment<Mesh> {
  @property({ type: ValueType.Float, description: 'Sphere radius' }) radius = 1;
  @property({ type: ValueType.Int, description: 'Horizontal (longitude) segments' }) widthSegments = 32;
  @property({ type: ValueType.Int, description: 'Vertical (latitude) segments' }) heightSegments = 16;

  private cached?: SphereGeometry;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.geometry = (this.cached ??= new SphereGeometry(this.radius, this.widthSegments, this.heightSegments));
  }
}
