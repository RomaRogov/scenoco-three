import { expect } from 'vitest';
import { speedOver, walkTo } from '../arms.js';
import type { Game } from '../types.js';

/** The crate at (6, 3) is worth five, and slows the carrier to half speed. */
export function check(game: Game): void {
  const empty = speedOver(game, 0.5);
  expect(empty, 'the unloaded player should still move at 6 u/s').toBeCloseTo(6, 1);

  walkTo(game, 6, 3);
  expect(game.state.carried, 'the heavy crate was not picked up').toBe(1);

  const loaded = speedOver(game, 0.5);
  expect(loaded).toBeCloseTo(3, 1);

  walkTo(game, 0, 0);
  expect(game.state.score).toBe(5);
}
