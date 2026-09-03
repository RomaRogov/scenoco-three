import { expect } from 'vitest';
import { named, run } from '../arms.js';
import type { Game } from '../types.js';

/** The pad drifts between −4 and 4 on x, about eight seconds for a round trip. */
export function check(game: Game): void {
  const depot = named(game, 'depot');

  const seen: number[] = [];
  for (let i = 0; i < 160; i++) {
    run(game, 0.05);
    seen.push(depot.position.x);
  }

  const low = Math.min(...seen);
  const high = Math.max(...seen);

  expect(high - low, 'the depot did not move on x').toBeGreaterThan(1);
  expect(low).toBeCloseTo(-4, 0);
  expect(high).toBeCloseTo(4, 0);

  // Eight seconds a round trip: in the eight seconds sampled it should reach both ends once.
  expect(seen.filter((x, i) => i > 0 && x < seen[i - 1]!).length).toBeGreaterThan(10);
}
