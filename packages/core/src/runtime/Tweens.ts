import { System } from './System.js';
import { Time } from './Time.js';

/** Anything that advances itself when handed a time — a tween.js `Group`, or a lone `Tween`. */
export interface TweenTicker {
  update(time: number): unknown;
}

/** Anything that starts at a given time — a tween.js `Tween`. */
export interface TweenStarter {
  start(time: number): unknown;
}

/**
 * Runs a tween library — tween.js, say — on the **engine's** clock.
 *
 * A library's own `requestAnimationFrame` ticker runs on wall-clock time, so `timeScale = 0`
 * would pause the game while the tweens carried on. `play` exists for the same reason:
 * `tween.start()` with no argument stamps itself with `performance.now()`, a different origin,
 * and the tween then jumps or never moves.
 *
 * The interfaces above are structural, so nothing here imports tween.js.
 */
export class Tweens extends System {
  /** Scaled engine time in **milliseconds**, the unit tween libraries count in. */
  get time(): number {
    return Time.time * 1000;
  }

  private readonly tracked = new Set<TweenTicker>();

  /** Advance `ticker` every frame from now on. Returns this system, to keep `awake` one line. */
  track(ticker: TweenTicker): this {
    this.tracked.add(ticker);
    return this;
  }

  /** Stop advancing it. A component that owns a group should do this in `onDestroy`. */
  untrack(ticker: TweenTicker): void {
    this.tracked.delete(ticker);
  }

  /** Start a tween on the engine's clock. */
  play<T extends TweenStarter>(tween: T): T {
    tween.start(this.time);
    return tween;
  }

  override update(): void {
    const now = this.time;
    // A copy: a tween's `onComplete` commonly starts the next one, or destroys its owner.
    for (const ticker of [...this.tracked]) ticker.update(now);
  }

  override onDestroy(): void {
    this.tracked.clear();
  }
}
