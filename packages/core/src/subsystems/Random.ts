/**
 * The engine's deterministic PRNG (Unity `Random`). A small, seedable stream so a
 * run is reproducible from its seed — same seed + same fixed-step input ⇒
 * identical sequence (replays, tests, reproducible QA). The `Engine` owns one and
 * exposes it through `engine.random()` / `randomRange` / `randomInt` / `reseed` /
 * `seed`; components should use those instead of `Math.random()`.
 */
export class Random {
  private _seed: number;
  private next: () => number;

  constructor(seed?: number) {
    this._seed = (seed ?? Math.floor(Math.random() * 0x1_0000_0000)) >>> 0;
    this.next = mulberry32(this._seed);
  }

  /** The value the stream was last (re)seeded with. */
  get seed(): number {
    return this._seed;
  }

  /** Restart the stream from `seed` — for replays / reproducible runs. */
  reseed(seed: number): void {
    this._seed = seed >>> 0;
    this.next = mulberry32(this._seed);
  }

  /** Deterministic random in `[0, 1)` (Unity `Random.value`). */
  value(): number {
    return this.next();
  }

  /** Deterministic random float in `[min, max)`. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Deterministic random integer in `[min, max)` (max exclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }
}

/** mulberry32 — a tiny, fast, seedable PRNG for the engine's deterministic RNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
