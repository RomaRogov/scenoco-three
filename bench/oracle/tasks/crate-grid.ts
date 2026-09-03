import { expect } from 'vitest';
import { allNamed } from '../arms.js';
import type { Game } from '../types.js';

/** Sixteen crates on a 4-apart grid centred on the arena: every coordinate is ±2 or ±6. */
export function check(game: Game): void {
  expect(game.state.cratesRemaining).toBe(16);

  const crates = allNamed(game, 'crate');
  expect(crates).toHaveLength(16);

  const expected = [-6, -2, 2, 6];
  const cells = crates
    .map((crate) => `${round(crate.position.x)},${round(crate.position.z)}`)
    .sort();
  const wanted = expected
    .flatMap((x) => expected.map((z) => `${x},${z}`))
    .sort();
  expect(cells).toEqual(wanted);
}

/** Positions are authored, not simulated, so they should be exact — but not to a float's last bit. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
