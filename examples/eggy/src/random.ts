/**
 * Unity's `Random`, seeded: `Random.initState(level)` lays every level out the same way each time it
 * is played. Not Unity's generator, so a level looks different from the Unity build's — the same
 * kind of layout, not the same stones.
 */
let state = 1;

export const Random = {
  initState(seed: number): void {
    state = seed >>> 0 || 1;
  },
  /** 0..1 */
  get value(): number {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },
  /** A float in min..max — Unity's `Random.Range(float, float)`. */
  range(min: number, max: number): number {
    return min + (max - min) * Random.value;
  },
  /** An int in min..max-1 — Unity's `Random.Range(int, int)`; JavaScript cannot tell the two apart. */
  rangeInt(min: number, max: number): number {
    return Math.floor(min + (max - min) * Random.value);
  },
};
