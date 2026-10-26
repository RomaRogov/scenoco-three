import { Behaviour } from '@scenoco-three/core';

/**
 * A springy squash on its node: `punch()` and it squashes and wobbles back to its own scale.
 * Towers punch when they fire, the castle when it is hit, anything when it appears (`popIn`).
 */
export class Punch extends Behaviour {
  /** Grows from nothing at start, with an overshoot. */
  popIn = false;
  /** The scale it settles at. */
  rest = 1;

  private velocity = 0;
  private offset = 0;

  override awake() {
    if (this.popIn) this.offset = -1;
    this.apply();
  }

  /** Squash by `amount` (0.2 is a good thump): wider and shorter, then springs back. */
  punch(amount = 0.18) {
    this.velocity -= amount * 22;
  }

  override update(dt: number) {
    // A damped spring towards rest.
    const step = Math.min(dt, 1 / 30);
    this.velocity += (-this.offset * 240 - this.velocity * 13) * step;
    this.offset += this.velocity * step;
    this.apply();
  }

  private apply() {
    const s = this.rest;
    const y = Math.max(0.01, 1 + this.offset);
    const xz = Math.max(0.01, 1 - this.offset * 0.5) * (this.offset < -0.5 ? y : 1);
    this.node.scale.set(s * xz, s * y, s * xz);
  }
}
