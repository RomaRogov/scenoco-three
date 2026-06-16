import { Engine } from '@scenoco-three/core';
// Compiled to a compact bundle at build time (Vite plugin runs @scenoco-three/compiler
// in Node). The browser receives no XML parser — just the bundle data + component imports.
import breakoutScene from './scenes/breakout.scene.xml?bundle';

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) throw new Error('Missing #app canvas');

  const engine = new Engine({ canvas });
  // The scene declares a <PerspectiveCamera id="cam"> — loadScene() auto-activates it.
  engine.loadScene(breakoutScene);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
