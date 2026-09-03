import { expect } from 'vitest';
import { allNamed, walkTo } from '../arms.js';
import type { Game } from '../types.js';

/** A second pad at (0, −7) banks crates the way the first one does. */
export function check(game: Game): void {
  const pads = allNamed(game, 'depot');
  expect(pads, 'there should be two depots').toHaveLength(2);
  expect(
    pads.some((pad) => Math.abs(pad.position.x) < 0.01 && Math.abs(pad.position.z + 7) < 0.01),
    'no depot at (0, -7)',
  ).toBe(true);

  // Picked up far from the original pad, and banked at the new one without passing the old.
  walkTo(game, -2, -8);
  expect(game.state.carried, 'the crate was not picked up').toBe(1);
  walkTo(game, 0, -7);
  expect(game.state.score).toBe(1);
  expect(game.state.carried).toBe(0);
}
