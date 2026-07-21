import type { Object3D, WebGLRenderer } from 'three';
import { node } from '@scenoco-three/core';
import { Fullscreen } from '../uikit.js';
import { UIElementNode } from './UIElementNode.js';

@node({
  name: 'Fullscreen',
  description:
    'Screen-space UI root that always fills the viewport (uikit Fullscreen). Must be a child of the camera node; children are laid out in screen pixels.',
  attachments: false,
})
export class FullscreenNode extends UIElementNode {
  build(): Object3D {
    // uikit's Fullscreen wants the WebGLRenderer at construction, but node
    // factories are pure (no engine yet). `renderer` is a plain field only read
    // in update(), so UIRenderSystem injects the engine's renderer before the
    // first update — see UIRenderSystem.step.
    return new Fullscreen(undefined as unknown as WebGLRenderer, this.uikitProps());
  }
}
