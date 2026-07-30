import { TorusGeometry, type Mesh } from 'three';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { GeometryAttachment } from '../families.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({
  name: 'TorusGeometry',
  description: 'Torus (ring/donut) geometry for a mesh.',
})
export class TorusGeometryNode extends GeometryAttachment {
  @property({ type: ValueType.Float, description: 'Radius from the center to the tube center' }) radius = 1;
  @property({ type: ValueType.Float, description: 'Radius of the tube' }) tube = 0.4;
  @property({ type: ValueType.Int, description: 'Segments across the tube cross-section' }) radialSegments = 12;
  @property({ type: ValueType.Int, description: 'Segments around the ring' }) tubularSegments = 48;

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
