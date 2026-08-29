import { Event, System, Time } from '@scenoco-three/core';

/** What the round is doing. An ad has three states and no menu. */
export type Phase = 'playing' | 'won' | 'lost';

/**
 * One round: a clock, a score, and the two ways it can end.
 *
 * A playable ad is a single round of a single mechanic, so this is the whole of its rules. It is
 * a system because every target needs to reach it and it is a property of none of them — the same
 * reason `GameState` is one in the breakout example.
 */
export class Round extends System {
  /** Seconds on the clock. Authored per scene. */
  duration = 20;
  /** Score that ends the round early, as a win. */
  target = 12;
  /** Missing this many costs the round. */
  allowedMisses = 5;

  /** Raised when the round ends, either way. */
  readonly ended = new Event<[Phase]>();

  phase: Phase = 'playing';
  score = 0;
  misses = 0;
  remaining = 0;

  override start(): void {
    this.remaining = this.duration;
  }

  override update(): void {
    if (this.phase !== 'playing') return;
    this.remaining -= Time.deltaTime;
    if (this.remaining <= 0) {
      this.remaining = 0;
      this.finish(this.score >= this.target ? 'won' : 'lost');
    }
  }

  /** A target was tapped. */
  hit(points: number): void {
    if (this.phase !== 'playing') return;
    this.score += points;
    if (this.score >= this.target) this.finish('won');
  }

  /** A target reached the floor untouched. */
  miss(): void {
    if (this.phase !== 'playing') return;
    this.misses += 1;
    if (this.misses >= this.allowedMisses) this.finish('lost');
  }

  private finish(phase: Phase): void {
    this.phase = phase;
    this.ended.emit(phase);
  }
}
