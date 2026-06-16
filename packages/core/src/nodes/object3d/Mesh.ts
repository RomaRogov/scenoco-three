import { Mesh } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../core/decorators.js';

@node({
  name: 'Mesh',
  description: 'A renderable object: requires one geometry child, optional material',
})
export class MeshNode extends Object3DNode {
  build(): Mesh {
    return new Mesh();
  }
}
