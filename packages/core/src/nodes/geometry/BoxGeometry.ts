import { BoxGeometry, type Mesh } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { GEOMETRY_TARGETS } from '../targets.js';

@attachment({
  name: 'BoxGeometry',
  description: 'Box (cuboid) geometry for a mesh.',
  target: GEOMETRY_TARGETS,
  group: 'geometry',
  required: true,
})
export class BoxGeometryNode extends Attachment<Mesh> {
  @property({ type: 'float', default: 1, description: 'Size along X' }) width = 1;
  @property({ type: 'float', default: 1, description: 'Size along Y' }) height = 1;
  @property({ type: 'float', default: 1, description: 'Size along Z' }) depth = 1;
  @property({ type: 'int', default: 1, description: 'Subdivisions along X' }) widthSegments = 1;
  @property({ type: 'int', default: 1, description: 'Subdivisions along Y' }) heightSegments = 1;
  @property({ type: 'int', default: 1, description: 'Subdivisions along Z' }) depthSegments = 1;

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
