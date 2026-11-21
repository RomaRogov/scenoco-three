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
    // Unity's reaches a little past 0..1, as its docs say.
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-0.1);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.1);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.6);
    expect(Mathf.perlinNoise(1.25, 7.5)).toBe(Mathf.perlinNoise(1.25, 7.5));
    // Smooth: a hundredth of a unit apart, values a little apart.
    expect(Math.abs(Mathf.perlinNoise(4.5, 2.25) - Mathf.perlinNoise(4.51, 2.25))).toBeLessThan(0.03);
    // Unity's own: Mathf.PerlinNoise in Unity 6 read these, to the last digit of a float.
    const unity: [number, number, number][] = [[0, 0, 0.465273082], [0.5, 0.5, 0.2966959], [1.3, 2.7, 0.57015276], [10.25, 3.75, 0.559137], [180.1, 0.2, 0.499798238], [3.7, 9.1, 0.601141334], [-1.5, 0.5, 0.6338503]];
    for (const [x, y, value] of unity) expect(Mathf.perlinNoise(x, y)).toBeCloseTo(value, 6);
  });
});
