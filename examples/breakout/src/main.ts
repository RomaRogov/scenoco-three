import { Engine, SceneManager } from '@scenoco-three/core';
import { HudScene } from '../assets/scenes/hud.scene.gen.js';
import { Level1Scene } from '../assets/scenes/level-1.scene.gen.js';

const engine = new Engine();

// The HUD is loaded alongside the level and marked as surviving a load, so the score, the lives
// and the readout showing them are the same objects from the first level to the last. Every
// level after this one is loaded by `Progress`, which is in it.
await SceneManager.loadAdditive(HudScene);
await SceneManager.load(Level1Scene);
engine.start();

// A handle for poking at a running game from devtools, and for driving it a frame at a time
// when `requestAnimationFrame` will not run — a background tab, an automated check.
Object.assign(window as unknown as Record<string, unknown>, {
  scenoco: {
    engine,
    SceneManager,
    get scene() {
      return SceneManager.activeScene;
    },
    step(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) {
        clock += dt * 1000;
        SceneManager.tick(clock);
        engine.render();
      }
    },
  },
});
let clock = performance.now();
