import { CylinderGeometry, type Mesh } from 'three';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { GeometryAttachment } from '../families.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';

@attachment({
  name: 'CylinderGeometry',
  description: 'Cylinder (or cone/frustum) geometry for a mesh.',
})
export class CylinderGeometryNode extends GeometryAttachment {
  @property({ type: ValueType.Float, description: 'Radius of the top cap' }) radiusTop = 1;
  @property({ type: ValueType.Float, description: 'Radius of the bottom cap' }) radiusBottom = 1;
  @property({ type: ValueType.Float, description: 'Height along Y' }) height = 1;
  @property({ type: ValueType.Int, description: 'Segments around the circumference' }) radialSegments = 32;

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
