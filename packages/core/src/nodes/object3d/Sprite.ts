import { Sprite } from 'three';
import { Object3DNode } from '../base.js';
import { node } from '../../registry/decorators.js';

@node({
  name: 'Sprite',
  description: 'A camera-facing textured quad: optional SpriteMaterial, no geometry',
})
export class SpriteNode extends Object3DNode {
  build(): Sprite {
    return new Sprite();
  }
}
