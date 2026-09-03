import { Engine, Input, KeyCode, SceneManager } from '@scenoco-three/core';
import { MainScene } from '../assets/scenes/main.scene.gen.js';
import { Player } from './Player.js';

/**
 * The browser entry.
 *
 * Reading the keyboard lives here rather than on `Player`, so the same component runs unchanged
 * under the test harness — which writes `player.move` itself. Nothing branches on the environment.
 *
 * `onBeforeRender` runs after the tick, so a key pressed this frame steers the next one. At 60fps
 * that is 16ms of lag and nobody can feel it; putting the reader in a component instead would
 * have to run before `Player` in document order, which is a more fragile thing to depend on.
 */
const engine = new Engine();
const scene = await SceneManager.load(MainScene);
const player = scene.findObjectOfType(Player)!;

engine.onBeforeRender = () => {
  const x = (Input.getKey(KeyCode.D) ? 1 : 0) - (Input.getKey(KeyCode.A) ? 1 : 0);
  const y = (Input.getKey(KeyCode.W) ? 1 : 0) - (Input.getKey(KeyCode.S) ? 1 : 0);
  player.move.set(x, y);
};

engine.start();
