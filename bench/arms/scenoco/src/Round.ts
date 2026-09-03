import { Component } from '@scenoco-three/core';
import { Crate } from './Crate.js';

/**
 * The round: the clock, and the three counters a player watches.
 *
 * Only `duration` is a public field, because in this framework a public field *is* an XML
 * attribute — and a score that could be written into the document would be a setting, not a
 * score. Everything the round accumulates is a getter over private state, and moves through the
 * two methods below rather than by assignment from outside.
 *
 * Every other component asks this one whether the round is still live, so "nothing happens after
 * the clock reaches zero" is decided in one place rather than repeated in three.
 */
export class Round extends Component {
  /** Seconds on the clock at the start. */
  duration = 60;

  #timeLeft = 0;
  #score = 0;
  #carried = 0;
  #cratesRemaining = 0;

  /** Seconds left, floored at 0. */
  get timeLeft(): number {
    return this.#timeLeft;
  }

  /** Crates banked at the depot. */
  get score(): number {
    return this.#score;
  }

  /** Crates on the player's back. */
  get carried(): number {
    return this.#carried;
  }

  /** Crates still lying in the arena. */
  get cratesRemaining(): number {
    return this.#cratesRemaining;
  }

  /** True while the round is still running. */
  get live(): boolean {
    return this.#timeLeft > 0;
  }

  /**
   * Counted in `awake`, not `start`.
   *
   * The scene is fully built before anything wakes, so every crate is already there — and a
   * caller reading the state before the first frame (a test harness does exactly that) must not
   * see a zero that is really "not counted yet". Counting is also better than deriving: a crate
   * that has been picked up is neither in the arena nor destroyed, since destruction is deferred
   * to the end of the frame, so a count taken from the scene graph is ambiguous for precisely as
   * long as it matters.
   */
  override awake(): void {
    this.#timeLeft = this.duration;
    this.#cratesRemaining = this.scene!.findObjectsOfType(Crate, true).length;
  }

  /** One crate leaves the arena for the player's back. */
  take(): void {
    this.#carried += 1;
    this.#cratesRemaining -= 1;
  }

  /** The stack is banked. Returns how many, which is what the caller has to dispose of. */
  bank(): number {
    const delivered = this.#carried;
    this.#score += delivered;
    this.#carried = 0;
    return delivered;
  }

  /**
   * The clock, run before anything else each frame.
   *
   * Ordering is part of the specification and it is observable: a crate touched on the frame the
   * clock reaches zero is not collected. Running the timer first is what makes that true.
   */
  override update(dt: number): void {
    this.#timeLeft = Math.max(0, this.#timeLeft - dt);
  }
}
