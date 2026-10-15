import { Behaviour, WaitForSeconds, destroy } from '@scenoco-three/core';

/** Removes its node after a while — a coroutine, as in Unity. */
export class Fade extends Behaviour {
  seconds = 2;

  start() {
    this.startCoroutine(this.later());
  }

  private *later() {
    yield new WaitForSeconds(this.seconds);
    destroy(this.node);
  }
}
