import type { Object3D } from 'three';
import { node, property, ValueType } from '@scenoco-three/core';
import { Image } from '../uikit.js';
import { ObjectFit } from '../enums.js';
import { UIElementNode } from './UIElementNode.js';

@node({
  name: 'Image',
  description: 'UI image element (uikit Image — textured panel with aspect-ratio handling)',
  attachments: false,
})
export class ImageNode extends UIElementNode {
  @property({ type: ValueType.String, asset: 'texture', description: 'Image URL to display', required: true })
  src = '';
  @property({ type: ObjectFit, description: 'How the image fills its bounds (CSS object-fit)' }) objectFit?: string;

  build(): Object3D {
    return new Image(this.uikitProps());
  }
}
