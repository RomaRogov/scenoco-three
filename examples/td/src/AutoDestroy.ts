import { Behaviour, destroy } from '@scenoco-three/core';

/** Removes its node after `seconds`: a one-off effect cleaning up after itself. */
export class AutoDestroy extends Behaviour {
  seconds = 1.5;

  override update(dt: number) {
    this.seconds -= dt;
    if (this.seconds <= 0) destroy(this.node);
  }
}
