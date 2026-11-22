import { Vector3 } from 'three';
import { Behaviour, Ease, LoopType, RotateMode, destroy, findObjectOfType } from '@scenoco-three/core';
import type { Collider } from '@scenoco-three/rapier';
import { CoinCounter } from './CoinCounter';
import { Player } from './Player';

/**
 * A coin over the path: it turns for ever, and when the player walks into its trigger it counts,
 * then shrinks away and is gone. All of its motion is tweens.
 */
export class Coin extends Behaviour {
  private taken = false;

  override start() {
    this.node.doLocalRotate(new Vector3(0, 360, 0), 2, RotateMode.FastBeyond360).setEase(Ease.Linear).setLoops(-1, LoopType.Incremental);
  }

  /** Unity's `OnTriggerEnter`: its collider is a trigger, and the player's controller walked in. */
  override onTriggerEnter(other: Collider) {
    if (this.taken || !other.getComponent(Player)) return;
    this.taken = true;
    findObjectOfType(CoinCounter)?.collect();
    this.node.doKill();
    this.node.doLocalMoveY(this.node.position.y + 0.8, 0.3).setEase(Ease.OutQuad);
    this.node.doScale(0, 0.3).setEase(Ease.InBack).onComplete(() => destroy(this.node));
  }
}
