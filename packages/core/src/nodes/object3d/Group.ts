import { Group } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../registry/decorators.js';

@node({ name: 'Group', description: 'An empty Object3D that groups its children' })
export class GroupNode extends Object3DNode {
  build(): Group {
    return new Group();
  }
}
