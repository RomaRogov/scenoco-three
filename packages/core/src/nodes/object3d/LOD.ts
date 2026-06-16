import { LOD } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../core/decorators.js';

// Level distances are not yet declarative — a companion component registers
// child meshes as LOD levels. The tag exists so an LOD can live in the graph.
@node({ name: 'LOD', description: 'Level-of-detail switch between child meshes; levels wired by a component' })
export class LODNode extends Object3DNode {
  build(): LOD {
    return new LOD();
  }
}
