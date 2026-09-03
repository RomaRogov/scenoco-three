import { expect } from 'vitest';
import { walkTo } from '../arms.js';
import type { Game } from '../types.js';

/** A delivery puts five seconds back on the clock. */
export function check(game: Game): void {
  walkTo(game, -3, 5);
  expect(game.state.carried, 'the crate was not picked up').toBe(1);

  const before = game.state.timeLeft;
  walkTo(game, 0, 0);
  expect(game.state.score).toBe(1);

  // The walk itself costs time, so the clock must be *higher* than it would have been — the
  // bonus has to outweigh the seconds spent getting there.
  expect(game.state.timeLeft).toBeGreaterThan(before);
}
