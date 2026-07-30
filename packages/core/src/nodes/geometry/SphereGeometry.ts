import { SphereGeometry, type Mesh } from 'three';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { GeometryAttachment } from '../families.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({
  name: 'SphereGeometry',
  description: 'Sphere geometry for a mesh.',
})
export class SphereGeometryNode extends GeometryAttachment {
  @property({ type: ValueType.Float, description: 'Sphere radius' }) radius = 1;
  @property({ type: ValueType.Int, description: 'Horizontal (longitude) segments' }) widthSegments = 32;
  @property({ type: ValueType.Int, description: 'Vertical (latitude) segments' }) heightSegments = 16;

  private cached?: SphereGeometry;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.geometry = (this.cached ??= new SphereGeometry(this.radius, this.widthSegments, this.heightSegments));
  }
}
