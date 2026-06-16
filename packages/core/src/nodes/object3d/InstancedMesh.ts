import { InstancedMesh } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

// Per-instance transforms are written at runtime (a component fills
// `.setMatrixAt(i, …)`); the tag carries the instance `count` and the shared
// geometry/material, exactly like a Mesh.
@node({
  name: 'InstancedMesh',
  description: 'A mesh drawn `count` times in one draw call; instance matrices set by a component',
})
export class InstancedMeshNode extends Object3DNode {
  @property({ type: 'int', default: 1, description: 'Number of instances' }) count = 1;

  build(): InstancedMesh {
    return new InstancedMesh(undefined, undefined, this.count);
  }
}
