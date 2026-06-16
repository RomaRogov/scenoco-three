import { Group } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../core/decorators.js';

@node({
  name: 'Scene',
  kind: 'scene',
  description: 'Root of a scene file',
})
export class SceneNode extends Object3DNode {
  build(): Group {
    return new Group();
  }
}
