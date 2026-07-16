import { LineLoop } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../registry/decorators.js';

@node({
  name: 'LineLoop',
  description: 'A closed polyline (last vertex connects to the first)',
})
export class LineLoopNode extends Object3DNode {
  build(): LineLoop {
    return new LineLoop();
  }
}
