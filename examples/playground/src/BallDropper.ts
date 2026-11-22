import { Behaviour, Random, Tween, WaitForSeconds, destroy, instantiate, type Prefab } from '@scenoco-three/core';

/** Drops a ball every `every` seconds somewhere over its spot, in a coroutine; each one goes after `lifetime`. */
export class BallDropper extends Behaviour {
  ball: Prefab | null = null;
  every = 1.4;
  /** How far from its spot a ball may drop, across x and z. */
  spread = 1.5;
  lifetime = 7;

  override start() {
    this.startCoroutine(this.drop());
  }

  private *drop() {
    while (this.ball) {
      const at = this.node.position.clone();
      at.x += Random.range(-this.spread, this.spread);
      at.z += Random.range(-this.spread, this.spread);
      const ball = instantiate(this.ball, { position: at });
      Tween.delayedCall(this.lifetime, () => destroy(ball)).setLink(ball);
      yield new WaitForSeconds(this.every);
    }
  }
}
