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

  it("gives Unity's own numbers for a seed: Random.InitState(1) in Unity 6 read these", () => {
    Random.initState(1);
    expect([Random.value, Random.value, Random.value].map((v) => +v.toPrecision(7))).toEqual([0.9996847, 0.7742628, 0.6809838]);
    Random.initState(1);
    expect([Random.range(22, 61), Random.range(22, 61), Random.range(22, 61)].map((v) => +v.toPrecision(7))).toEqual([22.0123, 30.80375, 34.44163]);
    Random.initState(1);
    expect([Random.rangeInt(0, 7), Random.rangeInt(0, 7), Random.rangeInt(0, 7)]).toEqual([3, 4, 3]);
  });
});
