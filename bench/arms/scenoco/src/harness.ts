import { SceneManager, Time } from '@scenoco-three/core';
import type { Scene } from 'three';
import { MainScene } from '../assets/scenes/main.scene.gen.js';
import { Player } from './Player.js';
import { Round } from './Round.js';

/**
 * The benchmark seam. Declared locally rather than imported — this is a standalone project — and
 * checked structurally where the oracle assigns it.
 */
export interface GameState {
  score: number;
  carried: number;
  timeLeft: number;
  cratesRemaining: number;
}

export interface Game {
  scene: Scene;
  state: GameState;
  input: { move(x: number, y: number): void };
  step(dt: number): void;
  dispose(): void;
}

/**
 * Build the game with no renderer and no engine, driven a frame at a time.
 *
 * There is no `Engine` here on purpose: it owns a `WebGLRenderer`, and the oracle asserts on the
 * scene graph rather than on pixels. `SceneManager.tick` is the same call `Engine` makes from its
 * frame loop, so what runs is the game, not a test double of it.
 */
export async function createGame(): Promise<Game> {
  Time.reset();
  Time.timeScale = 1;
  Time.fixedDeltaTime = 1 / 50;
  SceneManager.resetFrameClock();

  const scene = await SceneManager.load(MainScene);
  const round = scene.findObjectOfType(Round)!;
  const player = scene.findObjectOfType(Player)!;

  // A synthetic clock: `tick` takes a timestamp, so stepping means advancing one.
  let now = 0;

  return {
    scene,
    // A live view of the four numbers, not the component: `Round` is a scene object with a uuid
    // and a lifecycle, and handing it over would let an oracle read — or serialise — all of it.
    state: {
      get score() {
        return round.score;
      },
      get carried() {
        return round.carried;
      },
      get timeLeft() {
        return round.timeLeft;
      },
      get cratesRemaining() {
        return round.cratesRemaining;
      },
    },
    input: {
      move(x, y) {
        player.move.set(x, y);
      },
    },
    step(dt) {
      now += dt * 1000;
      SceneManager.tick(now);
    },
    dispose() {
      void SceneManager.unloadAll();
    },
  };
}
