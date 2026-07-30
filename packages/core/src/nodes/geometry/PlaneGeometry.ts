import { PlaneGeometry, type Mesh } from 'three';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { GeometryAttachment } from '../families.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({
  name: 'PlaneGeometry',
  description: 'Flat plane geometry (in the XY plane) for a mesh.',
})
export class PlaneGeometryNode extends GeometryAttachment {
  @property({ type: ValueType.Float, description: 'Size along X' }) width = 1;
  @property({ type: ValueType.Float, description: 'Size along Y' }) height = 1;
  @property({ type: ValueType.Int, description: 'Subdivisions along X' }) widthSegments = 1;
  @property({ type: ValueType.Int, description: 'Subdivisions along Y' }) heightSegments = 1;

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
