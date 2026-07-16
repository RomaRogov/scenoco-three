import { CylinderGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({
  name: 'CylinderGeometry',
  description: 'Cylinder (or cone/frustum) geometry for a mesh.',
  target: GEOMETRY_TARGETS,
  group: 'geometry',
  required: true,
})
export class CylinderGeometryNode extends Attachment<Mesh> {
  @property({ type: ValueType.Float, default: 1, description: 'Radius of the top cap' }) radiusTop = 1;
  @property({ type: ValueType.Float, default: 1, description: 'Radius of the bottom cap' }) radiusBottom = 1;
  @property({ type: ValueType.Float, default: 1, description: 'Height along Y' }) height = 1;
  @property({ type: ValueType.Int, default: 32, description: 'Segments around the circumference' }) radialSegments = 32;

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
