import { Object3D } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../registry/decorators.js';

@node({ name: 'Object3D', description: 'The base transform node — holds children and components, renders nothing' })
export class BaseObject3DNode extends Object3DNode {
  build(): Object3D {
    return new Object3D();
  }
}
