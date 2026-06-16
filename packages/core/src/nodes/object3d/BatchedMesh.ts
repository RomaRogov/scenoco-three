import { BatchedMesh } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

// Geometries are added at runtime (`.addGeometry`/`.addInstance` from a
// component); the tag pre-allocates the buffers via its max* attributes.
@node({
  name: 'BatchedMesh',
  description: 'Many static geometries batched into one draw call; populated by a component',
})
export class BatchedMeshNode extends Object3DNode {
  @property({ type: 'int', default: 256 }) maxInstanceCount = 256;
  @property({ type: 'int', default: 8192 }) maxVertexCount = 8192;

  build(): BatchedMesh {
    return new BatchedMesh(this.maxInstanceCount, this.maxVertexCount);
  }
}
