import { TorusGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({
  name: 'TorusGeometry',
  description: 'Torus (ring/donut) geometry for a mesh.',
  target: GEOMETRY_TARGETS,
  group: 'geometry',
  required: true,
})
export class TorusGeometryNode extends Attachment<Mesh> {
  @property({ type: ValueType.Float, default: 1, description: 'Radius from the center to the tube center' }) radius = 1;
  @property({ type: ValueType.Float, default: 0.4, description: 'Radius of the tube' }) tube = 0.4;
  @property({ type: ValueType.Int, default: 12, description: 'Segments across the tube cross-section' }) radialSegments = 12;
  @property({ type: ValueType.Int, default: 48, description: 'Segments around the ring' }) tubularSegments = 48;

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
