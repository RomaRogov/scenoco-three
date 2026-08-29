import { Event, System, Time } from '@scenoco-three/core';

/** What the run is doing. An ad has three states and no menu. */
export type Phase = 'playing' | 'won' | 'lost';

/**
 * One run: a clock, a delivered count, and the two ways it ends.
 *
 * The same shape as the tap playable's `Round` — a system, because every crate and the depot all
 * need to reach it and it is a property of none of them.
 */
export class Run extends System {
  duration = 30;
  /** Deliver this many to win. */
  quota = 10;

  readonly ended = new Event<[Phase]>();

  phase: Phase = 'playing';
  delivered = 0;
  remaining = 0;

  override start(): void {
    this.remaining = this.duration;
  }

  override update(): void {
    if (this.phase !== 'playing') return;
    this.remaining -= Time.deltaTime;
    if (this.remaining > 0) return;
    this.remaining = 0;
    this.finish(this.delivered >= this.quota ? 'won' : 'lost');
  }

  deliver(count: number): void {
    if (this.phase !== 'playing') return;
    this.delivered += count;
    if (this.delivered >= this.quota) this.finish('won');
  }

  private finish(phase: Phase): void {
    this.phase = phase;
    this.ended.emit(phase);
  }
}
