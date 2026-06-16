import { Points } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../core/decorators.js';

@node({
  name: 'Points',
  description: 'A particle cloud: one rendered point per geometry vertex',
})
export class PointsNode extends Object3DNode {
  build(): Points {
    return new Points();
  }
}
