import { expect } from 'vitest';
import { allNamed, groundGap, named, run, type Sketch } from '../arms.js';

/** One task's assertions, run identically against every stack. */
export type Check = (sketch: Sketch) => void;

/**
 * The checks are written against *names and geometry*, never against a stack's own types.
 *
 * A prototype is judged the way a person judges one — is the thing there, is it the right shape,
 * is it in the right place, does it move — because that is the only question the three stacks can
 * be asked in the same words.
 */
export const CHECKS: Record<string, Check> = {
  pillars: (sketch) => {
    const pillars = allNamed(sketch, 'pillar');
    expect(pillars, 'expected three nodes named "pillar"').toHaveLength(3);

    const xs = pillars.map((p) => Math.round(p.getWorldPosition(p.position.clone()).x));
    expect([...xs].sort((a, b) => a - b)).toEqual([-3, 0, 3]);

    for (const pillar of pillars) {
      expect(groundGap(pillar), 'a pillar is not standing on the ground').toBeCloseTo(0, 1);
    }
  },

  stack: (sketch) => {
    const bricks = allNamed(sketch, 'brick');
    expect(bricks, 'expected five nodes named "brick"').toHaveLength(5);

    const ys = bricks
      .map((b) => b.getWorldPosition(b.position.clone()).y)
      .sort((a, b) => a - b);
    // Stacked, not co-located: each one clearly above the last, and the pile starts on the ground.
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(0.4);

    const lowest = bricks.reduce((a, b) => (groundGap(a) <= groundGap(b) ? a : b));
    expect(groundGap(lowest), 'the stack does not rest on the ground').toBeCloseTo(0, 1);
  },

  moon: (sketch) => {
    const moon = named(sketch, 'moon');
    const start = moon.getWorldPosition(moon.position.clone());

    run(sketch, 1);
    const later = moon.getWorldPosition(moon.position.clone());
    expect(start.distanceTo(later), 'the moon did not move').toBeGreaterThan(0.2);

    // Orbiting, not drifting: it comes back rather than leaving.
    run(sketch, 30);
    const far = moon.getWorldPosition(moon.position.clone());
    expect(far.length(), 'the moon flew away instead of circling').toBeLessThan(
      start.length() * 3 + 3,
    );
  },
};
