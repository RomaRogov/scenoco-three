import { EASINGS, type EasingName } from './easing.js';

export type LoopMode = 'none' | 'loop' | 'pingpong';

export interface TweenOptions {
  /** Seconds for one pass from `from` to `to`. */
  duration: number;
  /** Easing curve name (default `quadInOut`). */
  easing?: EasingName;
  /** Repeat mode (default `none`). */
  loop?: LoopMode;
  /** Seconds to wait before starting (default 0). */
  delay?: number;
  /** Called once when a non-looping tween reaches the end. */
  onComplete?: () => void;
}

/**
 * A minimal numeric tween: interpolates a value (one or more channels) from
 * `from` to `to` over `duration`, applying each step through `onUpdate`. Driven
 * by `update(dt)` — so the engine's `timeScale` (slow-mo/pause) flows through for
 * free. Reusable on its own; the `<Tween>` component wires it to a node's
 * position/rotation/scale.
 *
 *   const t = new Tween([0, 0, 0], [0, 5, 0], (v) => mesh.position.set(v[0], v[1], v[2]),
 *                       { duration: 1.5, easing: 'bounceOut' });
 *   // in update(dt): t.update(dt);
 */
export class Tween {
  /** True once a non-looping tween has finished (looping tweens never set this). */
  done = false;
  private elapsed = 0;
  /** Reused output buffer — filled and handed to `onUpdate` each step (no per-frame allocation). */
  private readonly out: number[] = [];

  constructor(
    private readonly from: readonly number[],
    private readonly to: readonly number[],
    private readonly onUpdate: (values: readonly number[]) => void,
    private readonly options: TweenOptions,
  ) {}

  /** Advance by `dt` seconds and apply the eased value. No-op once `done`. */
  update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    const active = this.elapsed - (this.options.delay ?? 0);
    if (active < 0) return; // still in the delay

    const loop = this.options.loop ?? 'none';
    let t: number;
    if (loop === 'none') {
      t = Math.min(active / this.options.duration, 1);
    } else {
      const phase = active / this.options.duration;
      const cycle = Math.floor(phase);
      const local = phase - cycle;
      t = loop === 'pingpong' && cycle % 2 === 1 ? 1 - local : local;
    }

    const eased = EASINGS[this.options.easing ?? 'quadInOut'](t);
    const { from, to, out } = this;
    out.length = from.length;
    for (let i = 0; i < from.length; i++) {
      const f = from[i]!;
      out[i] = f + ((to[i] ?? f) - f) * eased;
    }
    this.onUpdate(out);

    if (loop === 'none' && t >= 1) {
      this.done = true;
      this.options.onComplete?.();
    }
  }
}
