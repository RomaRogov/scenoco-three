import { ArrayCamera } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../core/decorators.js';

// Sub-cameras are supplied at runtime (a component populates `.cameras`); the
// tag exists so an ArrayCamera can live in the scene graph and carry components.
@node({ name: 'ArrayCamera', description: 'Camera that renders an array of sub-cameras (VR/multi-view)' })
export class ArrayCameraNode extends Object3DNode {
  build(): ArrayCamera {
    return new ArrayCamera();
  }
}
