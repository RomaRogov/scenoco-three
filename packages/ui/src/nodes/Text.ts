import type { Object3D } from 'three';
import { node, property, ValueType } from '@scenoco-three/core';
import { Text } from '../uikit.js';
import { INTER_MSDF_CHARSET } from '../charset.js';
import { UIElementNode } from './UIElementNode.js';

@node({
  name: 'Text',
  description: 'UI text element (uikit Text — MSDF text, laid out by flexbox like everything else)',
  attachments: false,
})
export class TextNode extends UIElementNode {
  @property({
    type: ValueType.String,
    charset: INTER_MSDF_CHARSET,
    description: 'The text content to display (ASCII-ish — the MSDF font has no em-dash, ellipsis or accents)',
  })
  text = '';

  build(): Object3D {
    return new Text(this.uikitProps());
  }
}
