import { Behaviour, Tween, destroy } from '@scenoco-three/core';

/** Destroys its node `seconds` after it starts: a burst of sparks that has burnt out. */
export class Lifetime extends Behaviour {
  seconds = 1;

  override start(): void {
    Tween.delayedCall(this.seconds, () => destroy(this.node)).setLink(this);
  }
}
