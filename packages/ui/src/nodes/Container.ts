import type { Object3D } from 'three';
import { node } from '@scenoco-three/core';
import { Container } from '../uikit.js';
import { UIElementNode } from './UIElementNode.js';

@node({
  name: 'Container',
  description: 'UI flexbox container (uikit Container — the UI equivalent of an HTML div)',
  attachments: false,
})
export class ContainerNode extends UIElementNode {
  build(): Object3D {
    return new Container(this.uikitProps());
  }
}
