import { expect } from 'vitest';
import { walkTo } from '../arms.js';
import type { Game } from '../types.js';

/** Five is the limit, and a sixth crate stays where it is. */
export function check(game: Game): void {
  // Six of the ten, in a route that visits each.
  const route: ReadonlyArray<readonly [number, number]> = [
    [-3, 5],
    [2, 7],
    [6, 3],
    [7, -4],
    [8, 6],
    [-7, 2],
  ];
  for (const [x, z] of route) walkTo(game, x, z);

  expect(game.state.carried).toBe(5);
  // The sixth was walked over and left: five gone from the arena, not six.
  expect(game.state.cratesRemaining).toBe(5);
}
