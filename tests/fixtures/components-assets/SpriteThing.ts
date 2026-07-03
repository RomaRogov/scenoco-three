import { Component, component, property } from '@scenoco-three/core';
// Importing a binary asset from a component: the Vite app build inlines this,
// but the component compiler's esbuild pass had no loader for it and failed
// (CORE-IMPROVEMENTS #5). The Node-side pass only needs the module to register.
import spriteUrl from './pixel.png';

@component({ name: 'SpriteThing', description: 'A component that imports a binary texture asset.' })
export class SpriteThing extends Component {
  @property({ type: 'string', description: 'Resolved sprite URL (proves the asset import compiled).' })
  url = spriteUrl;
}
