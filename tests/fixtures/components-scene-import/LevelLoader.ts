import { Component, component } from '@scenoco-three/core';
// Loading the next level from a component: `?bundle` is compiled by
// @scenoco-three/vite in the browser build, but this file also has to load
// Node-side so its @component registers. esbuild has no `.xml` loader, so
// before the stub plugin this import failed the whole component set and left
// the registry empty — every tag in every scene then read as unknown.
import nextLevel from './level_2.scene.xml?bundle';

@component({ name: 'LevelLoader', description: 'A component that imports another scene as a bundle.' })
export class LevelLoader extends Component {
  override start(): void {
    this.engine.loadScene(nextLevel);
  }
}
