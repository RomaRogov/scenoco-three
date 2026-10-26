/**
 * Unity's `Mathf`, for what JavaScript's `Math` does not spell the same way. `Math.max`, `Math.pow`,
 * `Math.round` and the rest stay JavaScript's own.
 */
export const Mathf = {
  /** `value` held between `min` and `max`. */
  clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
  },

  /** `value` held between 0 and 1. */
  clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  },

  /** From `a` to `b` by `t`, with `t` held between 0 and 1. */
  lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Mathf.clamp01(t);
  },

  /** From `a` to `b` by `t`, past either end when `t` is. */
  lerpUnclamped(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  },

  /** Where `value` is between `a` and `b`, 0..1. */
  inverseLerp(a: number, b: number, value: number): number {
    return a === b ? 0 : Mathf.clamp01((value - a) / (b - a));
  },

  /** From `from` to `to` by `t`, easing in and out. */
  smoothStep(from: number, to: number, t: number): number {
    const s = Mathf.clamp01(t);
    return from + (to - from) * s * s * (3 - 2 * s);
  },

  /** `current` moved towards `target` by at most `maxDelta`, never past it. */
  moveTowards(current: number, target: number, maxDelta: number): number {
    return Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta;
  },

  /** `t` wrapped into 0..length. */
  repeat(t: number, length: number): number {
    return Mathf.clamp(t - Math.floor(t / length) * length, 0, length);
  },

  /** `t` bouncing between 0 and length. */
  pingPong(t: number, length: number): number {
    const r = Mathf.repeat(t, length * 2);
    return length - Math.abs(r - length);
  },

  /** The shortest difference between two angles in degrees, -180..180. */
  deltaAngle(current: number, target: number): number {
    const delta = Mathf.repeat(target - current, 360);
    return delta > 180 ? delta - 360 : delta;
  },

  /** From angle `a` to `b` in degrees by `t`, the short way round. */
  lerpAngle(a: number, b: number, t: number): number {
    return a + Mathf.deltaAngle(a, b) * Mathf.clamp01(t);
  },

  /** True when two numbers are equal but for floating point error. */
  approximately(a: number, b: number): boolean {
    return Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), Number.EPSILON * 8);
  },

  /**
   * 2D Perlin noise, about 0..1 — smooth hills with features one unit apart: scale the coordinates
   * to scale them. The same point gives the same value every time; offset `x` to get another field.
   */
  perlinNoise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const a = PERM[(xi & 255)]! + (yi & 255);
    const b = PERM[((xi + 1) & 255)]! + (yi & 255);
    const value = lerp(
      lerp(grad(PERM[a]!, xf, yf), grad(PERM[b]!, xf - 1, yf), u),
      lerp(grad(PERM[a + 1]!, xf, yf - 1), grad(PERM[b + 1]!, xf - 1, yf - 1), u),
      v,
    );
    // Perlin's 2D noise spans about -0.7..0.7: stretched to Unity's 0..1.
    return (value / 0.7 + 1) / 2;
  },
};

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function grad(hash: number, x: number, y: number): number {
  switch (hash & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

// Ken Perlin's reference permutation, twice over so lookups never wrap.
const BASE = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
const PERM = Uint8Array.from({ length: 512 }, (_, i) => BASE[i & 255]!);
