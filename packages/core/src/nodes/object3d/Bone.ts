import { Bone } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../registry/decorators.js';

@node({ name: 'Bone', description: 'A skeleton joint (Object3D) — compose into a hierarchy for a SkinnedMesh' })
export class BoneNode extends Object3DNode {
  build(): Bone {
    return new Bone();
  }
}
