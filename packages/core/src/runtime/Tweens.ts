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
 * Runs a tween library on the **engine's** clock.
 *
 * SceNoCo ships no tween of its own. It had one — a component that moved a node's position,
 * rotation or scale — and it covered three of the dozens of things a game animates while
 * everything else needed a different mechanism anyway. The answer is a real library:
 * [tween.js](https://github.com/tweenjs/tween.js), which three.js ships in its own addons, so it
 * costs no dependency at all:
 *
 * ```ts
 * import { Group, Tween, Easing } from 'three/addons/libs/tween.module.js';
 * import { Component, Tweens } from '@scenoco-three/core';
 *
 * export class Door extends Component {
 *   private readonly tweens = new Group();
 *   private runner!: Tweens;
 *
 *   override awake() { this.runner = this.requireSystem(Tweens).track(this.tweens); }
 *
 *   open() {
 *     this.runner.play(new Tween(this.object3D.position, this.tweens).to({ y: 3 }, 800)
 *       .easing(Easing.Quadratic.Out));
 *   }
 * }
 * ```
 *
 * ### What this exists for
 *
 * Every animation library comes with its own `requestAnimationFrame` ticker, and that ticker is
 * wrong here: it runs on wall-clock time, so `Time.timeScale = 0` would pause the game while the
 * tweens carried on, slow motion would not slow them, and the editor's frame-step would not step
 * them. This hands the library the engine's clock instead — one number, in the milliseconds
 * every tween library counts in — and everything follows from that for free.
 *
 * `play` exists because it is the half that is easy to get wrong: `tween.start()` with no
 * argument stamps itself with `performance.now()`, which is a different origin from this clock,
 * and the tween then jumps or never moves. Starting through the system cannot get that wrong.
 *
 * Nothing here imports tween.js — the two interfaces above are structural, so the system weighs
 * nothing in a project that does not tween, and works with anything shaped the same way.
 */
export class Tweens extends System {
  /**
   * Scaled engine time in **milliseconds**, which is the unit tween libraries count in.
   *
   * Scaled, so a paused game has a stopped clock and its tweens stop with it.
   */
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
    // A copy: a tween's `onComplete` commonly starts the next one, or destroys the thing that
    // owned the group it is in.
    for (const ticker of [...this.tracked]) ticker.update(now);
  }

  override onDestroy(): void {
    this.tracked.clear();
  }
}
