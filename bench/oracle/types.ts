import type { Scene } from 'three';

/**
 * The seam every arm implements, and the only thing an oracle may import.
 *
 * One task's assertions run unchanged against four different codebases, which is the whole reason
 * a cross-arm comparison is possible. Each arm declares this shape locally rather than importing
 * it — they are standalone projects — and TypeScript's structural typing turns any drift into a
 * compile error the moment the oracle assigns an arm's module to `Game`.
 *
 * The numbers behind every field are normative; the oracle is where they live.
 */
export interface GameState {
  /** Crates banked at the depot. */
  score: number;
  /** Crates currently on the player's back. */
  carried: number;
  /** Seconds left, floored at 0. */
  timeLeft: number;
  /** Crates still lying in the arena. */
  cratesRemaining: number;
}

export interface Game {
  /** The live scene, for assertions about what is actually in the world. */
  scene: Scene;
  /** Read live — an arm may return the object its game already keeps. */
  state: GameState;
  input: {
    /** Desired direction, clamped to length ≤ 1. Maps to world `(x, 0, −y)`. */
    move(x: number, y: number): void;
  };
  /** Advance the world by `dt` seconds. Deterministic. */
  step(dt: number): void;
  dispose(): void;
}

/** What an arm's `src/harness.ts` must export. */
export type CreateGame = () => Promise<Game>;
