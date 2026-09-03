import { Engine, SceneManager } from '@scenoco-three/core';
import { MainScene } from '../assets/scenes/main.scene.gen.js';

const engine = new Engine();
await SceneManager.load(MainScene);
engine.start();

// A handle for poking at a running game from devtools, and for driving it when
// `requestAnimationFrame` will not run — a background tab, an automated check, a screenshot.
// `resize()` then `render()` draws one frame on demand, and reading the canvas in that same task
// gets a real image: the drawing buffer is only cleared once the browser composites.
Object.assign(window as unknown as Record<string, unknown>, {
  scenoco: {
    engine,
    SceneManager,
    get scene() {
      return SceneManager.activeScene;
    },
  },
});
