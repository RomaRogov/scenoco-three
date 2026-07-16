import { BatchedMesh } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

// Geometries are added at runtime (`.addGeometry`/`.addInstance` from a
// component); the tag pre-allocates the buffers via its max* attributes.
@node({
  name: 'BatchedMesh',
  description: 'Many static geometries batched into one draw call; populated by a component',
})
export class BatchedMeshNode extends Object3DNode {
  @property({ type: ValueType.Int, description: 'Max number of batched instances to pre-allocate' }) maxInstanceCount = 256;
  @property({ type: ValueType.Int, description: 'Max total vertices to pre-allocate' }) maxVertexCount = 8192;

  build(): BatchedMesh {
    return new BatchedMesh(this.maxInstanceCount, this.maxVertexCount);
  }
}
