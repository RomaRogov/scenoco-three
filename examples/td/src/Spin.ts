import { Vector3 } from 'three';
import { Behaviour, Ease, LoopType, Random, RotateMode } from '@scenoco-three/core';

/** Turns and bobs its node for ever: the stars over an upgraded tower. Two looping tweens, as DOTween's SetLoops(-1). */
export class Spin extends Behaviour {
  /** Radians a second about y. */
  speed = 1.5;
  /** How far it bobs above and below where it was placed. */
  bob = 0.08;

  override start() {
    const node = this.node;
    node.doLocalRotate(new Vector3(0, 360, 0), (Math.PI * 2) / this.speed, RotateMode.FastBeyond360)
      .setEase(Ease.Linear)
      .setLoops(-1, LoopType.Incremental);
    // Down to its lowest, then up and down for ever — each on its own beat.
    node.position.y -= this.bob;
    node.doLocalMoveY(node.position.y + 2 * this.bob, 1.3)
      .setEase(Ease.InOutSine)
      .setLoops(-1, LoopType.Yoyo)
      .setDelay(Random.range(0, 1.3));
  }
}
