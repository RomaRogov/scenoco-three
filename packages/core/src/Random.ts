import { Color, Quaternion, SRGBColorSpace, Vector2, Vector3 } from 'three';

/** Where the generator stands: from `Random.state`, to put it back later and get the same numbers again. */
export type RandomState = readonly [number, number, number, number];

// xorshift128, seeded at load as Unity's is: a different run each time until `initState`.
let s: [number, number, number, number] = [0, 0, 0, 0];

/** The next 32 bits. */
function next(): number {
  let t = s[0];
  t ^= t << 11;
  t ^= t >>> 8;
  s = [s[1], s[2], s[3], (s[3] ^ (s[3] >>> 19) ^ t) >>> 0];
  return s[3];
}

/**
 * Unity's `Random`: one seeded generator for the game. `Random.initState(level)` lays a level out the
 * same way every time it is played; `Math.random()` is still there for what need not repeat.
 */
export const Random = {
  /** Start the sequence over from `seed`: the same seed, the same numbers. */
  initState(seed: number): void {
    // Unity's spreading of one seed into four words.
    const a = seed >>> 0;
    const b = (Math.imul(a, 1812433253) + 1) >>> 0;
    const c = (Math.imul(b, 1812433253) + 1) >>> 0;
    const d = (Math.imul(c, 1812433253) + 1) >>> 0;
    s = [a, b, c, d];
  },

  get state(): RandomState {
    return [...s];
  },
  set state(value: RandomState) {
    s = [value[0] >>> 0, value[1] >>> 0, value[2] >>> 0, value[3] >>> 0];
  },

  /** 0 up to 1. */
  get value(): number {
    return next() / 4294967296;
  },

  /** A number from `min` up to `max`. */
  range(min: number, max: number): number {
    return min + (max - min) * Random.value;
  },

  /** A whole number from `min` up to `max - 1` — Unity's `Range(int, int)`: `rangeInt(0, items.length)`. */
  rangeInt(min: number, max: number): number {
    return max <= min ? min : min + Math.floor((max - min) * Random.value);
  },

  /** A point inside a circle of radius 1, every spot as likely. */
  get insideUnitCircle(): Vector2 {
    const angle = Random.value * Math.PI * 2;
    const r = Math.sqrt(Random.value);
    return new Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
  },

  /** A point on a sphere of radius 1: a direction, every one as likely. */
  get onUnitSphere(): Vector3 {
    const z = Random.value * 2 - 1;
    const angle = Random.value * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
  },

  /** A point inside a sphere of radius 1, every spot as likely. */
  get insideUnitSphere(): Vector3 {
    return Random.onUnitSphere.multiplyScalar(Math.cbrt(Random.value));
  },

  /** A rotation, every one as likely. */
  get rotation(): Quaternion {
    const u = Random.value;
    const v = Random.value * Math.PI * 2;
    const w = Random.value * Math.PI * 2;
    const a = Math.sqrt(1 - u);
    const b = Math.sqrt(u);
    return new Quaternion(a * Math.sin(v), a * Math.cos(v), b * Math.sin(w), b * Math.cos(w));
  },

  /**
   * A colour picked by hue, saturation and value, each between its bounds, 0..1 — Unity's
   * `ColorHSV`. The numbers are sRGB, as a colour picker's are.
   */
  colorHSV(hueMin = 0, hueMax = 1, saturationMin = 0, saturationMax = 1, valueMin = 0, valueMax = 1): Color {
    const h = Random.range(hueMin, hueMax);
    const sat = Random.range(saturationMin, saturationMax);
    const v = Random.range(valueMin, valueMax);
    const f = (n: number) => {
      const k = (n + h * 6) % 6;
      return v - v * sat * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return new Color().setRGB(f(5), f(3), f(1), SRGBColorSpace);
  },
};

Random.initState(Math.floor(Math.random() * 4294967296));
