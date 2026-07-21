import { Engine } from '@scenoco-three/core';
// Side-effect registration for the tag packages this scene uses (decorators).
import '@scenoco-three/collision';
import '@scenoco-three/particles';
import '@scenoco-three/animation';
// Compiled to a compact bundle at build time (Vite plugin runs @scenoco-three/compiler
// in Node). The browser receives no XML parser — just the bundle data + component imports.
import subwayScene from './assets/scenes/subway.scene.xml?bundle';

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) throw new Error('Missing #app canvas');

  const engine = new Engine({ canvas });
  engine.loadScene(subwayScene);

  // The HUD's Restart button dispatches this; loadScene() is a full teardown +
  // reinstantiate, so re-running it against the same bundle is a clean reset —
  // no manual state-clearing needed anywhere in the game's own components.
  window.addEventListener('scenoco:restart', () => engine.loadScene(subwayScene));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
