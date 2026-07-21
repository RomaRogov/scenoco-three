import type { Object3D } from 'three';
import { node, property, ValueType } from '@scenoco-three/core';
import { Text } from '../uikit.js';
import { UIElementNode } from './UIElementNode.js';

@node({
  name: 'Text',
  description: 'UI text element (uikit Text — MSDF text, laid out by flexbox like everything else)',
  attachments: false,
})
export class TextNode extends UIElementNode {
  @property({ type: ValueType.String, description: 'The text content to display' }) text = '';

  build(): Object3D {
    return new Text(this.uikitProps());
  }
}
