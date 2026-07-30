import { BoxGeometry, type Mesh } from 'three';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { GeometryAttachment } from '../families.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({
  name: 'BoxGeometry',
  description: 'Box (cuboid) geometry for a mesh.',
})
export class BoxGeometryNode extends GeometryAttachment {
  @property({ type: ValueType.Float, description: 'Size along X' }) width = 1;
  @property({ type: ValueType.Float, description: 'Size along Y' }) height = 1;
  @property({ type: ValueType.Float, description: 'Size along Z' }) depth = 1;
  @property({ type: ValueType.Int, description: 'Subdivisions along X' }) widthSegments = 1;
  @property({ type: ValueType.Int, description: 'Subdivisions along Y' }) heightSegments = 1;
  @property({ type: ValueType.Int, description: 'Subdivisions along Z' }) depthSegments = 1;

  private cached?: BoxGeometry;
  attach(ctx: AttachContext<Mesh>): void {
    ctx.node.geometry = (this.cached ??= new BoxGeometry(
      this.width,
      this.height,
      this.depth,
      this.widthSegments,
      this.heightSegments,
      this.depthSegments,
    ));
  }
}
