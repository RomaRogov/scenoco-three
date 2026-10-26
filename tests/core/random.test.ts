import { describe, expect, it } from 'vitest';
import { Random } from '@scenoco-three/core';

describe('Random', () => {
  it('repeats its numbers from a seed or a saved state, and keeps each kind inside its bounds', () => {
    Random.initState(42);
    const first = Array.from({ length: 5 }, () => Random.value);
    const saved = Random.state;
    const next = [Random.range(-2, 2), Random.rangeInt(0, 3)];
    Random.initState(42);
    expect(Array.from({ length: 5 }, () => Random.value)).toEqual(first);
    Random.state = saved;
    expect([Random.range(-2, 2), Random.rangeInt(0, 3)]).toEqual(next);

    for (let i = 0; i < 500; i++) {
      const n = Random.rangeInt(0, 3);
      expect(Number.isInteger(n) && n >= 0 && n < 3).toBe(true);
      expect(Random.insideUnitCircle.length()).toBeLessThanOrEqual(1);
      expect(Random.insideUnitSphere.length()).toBeLessThanOrEqual(1);
      expect(Random.onUnitSphere.length()).toBeCloseTo(1);
      expect(Random.rotation.length()).toBeCloseTo(1);
    }
  });
});
