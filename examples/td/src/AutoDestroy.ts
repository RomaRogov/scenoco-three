import { Behaviour, Tween, destroy } from '@scenoco-three/core';

/** Removes its node `seconds` after it starts: a one-off effect cleaning up after itself. */
export class AutoDestroy extends Behaviour {
  seconds = 1.5;

  override start() {
    Tween.delayedCall(this.seconds, () => destroy(this.node)).setLink(this);
  }
}
