import { describe, expect, it } from 'vitest';
import { Mathf } from '@scenoco-three/core';

describe('Mathf', () => {
  it("does Unity's sums, and its Perlin noise is smooth, 0..1 and the same each time", () => {
    expect(Mathf.lerp(2, 4, 1.5)).toBe(4);
    expect(Mathf.inverseLerp(2, 4, 3)).toBe(0.5);
    expect(Mathf.deltaAngle(350, 10)).toBe(20);
    expect(Mathf.moveTowards(0, 10, 3)).toBe(3);
    expect(Mathf.pingPong(3, 2)).toBe(1);

    const samples = Array.from({ length: 2000 }, (_, i) => Mathf.perlinNoise(i * 0.137, i * 0.071 + 3));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-0.05);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.05);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.6);
    expect(Mathf.perlinNoise(1.25, 7.5)).toBe(Mathf.perlinNoise(1.25, 7.5));
    // Smooth: a hundredth of a unit apart, values a little apart.
    expect(Math.abs(Mathf.perlinNoise(4.5, 2.25) - Mathf.perlinNoise(4.51, 2.25))).toBeLessThan(0.03);
  });
});
