import type { Scene } from 'three';
import { Yard } from './game.js';

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
 * Build the game with no renderer, driven a frame at a time.
 *
 * `Yard` never had one: the renderer lives in `main.ts`, which is what makes the game runnable
 * in Node at all. What runs here is the game, not a test double of it.
 */
export function createGame(): Promise<Game> {
  const yard = new Yard();
  return Promise.resolve({
    scene: yard.scene,
    // A getter, so the oracle reads the live numbers rather than a snapshot taken at build time.
    get state() {
      return yard.state;
    },
    input: {
      move(x, y) {
        yard.setMove(x, y);
      },
    },
    step(dt) {
      yard.step(dt);
    },
    dispose() {
      yard.dispose();
    },
  });
}
