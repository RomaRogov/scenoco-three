import { SkinnedMesh } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../core/decorators.js';

// The skeleton is bound at runtime (a component calls `.bind(skeleton)`); the
// tag carries the geometry/material like a Mesh.
@node({
  name: 'SkinnedMesh',
  description: 'A mesh deformed by a skeleton; skeleton bound by a component',
})
export class SkinnedMeshNode extends Object3DNode {
  build(): SkinnedMesh {
    return new SkinnedMesh();
  }
}
