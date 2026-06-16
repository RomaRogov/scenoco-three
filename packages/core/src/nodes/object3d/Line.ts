import { Line } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../core/decorators.js';

@node({
  name: 'Line',
  description: 'A continuous polyline: requires a geometry, optional line material',
})
export class LineNode extends Object3DNode {
  build(): Line {
    return new Line();
  }
}
