import { expect } from 'vitest';
import { walkTo } from '../arms.js';
import type { Game } from '../types.js';

/** One crate, banked, is worth three. */
export function check(game: Game): void {
  walkTo(game, -3, 5);
  expect(game.state.carried, 'the crate was not picked up at all').toBe(1);
  walkTo(game, 0, 0);
  expect(game.state.score).toBe(3);
}
