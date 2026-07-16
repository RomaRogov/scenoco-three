import { LineSegments } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../registry/decorators.js';

@node({
  name: 'LineSegments',
  description: 'A set of disconnected line segments (vertices taken in pairs)',
})
export class LineSegmentsNode extends Object3DNode {
  build(): LineSegments {
    return new LineSegments();
  }
}
