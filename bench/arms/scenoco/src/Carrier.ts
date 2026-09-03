import { Vector3, type Mesh } from 'three';
import { Component } from '@scenoco-three/core';
import { Crate } from './Crate.js';
import { Player } from './Player.js';
import { Round } from './Round.js';

/**
 * Picking crates up, banking them at the depot, and keeping the stack on the player's back.
 *
 * One component rather than three because the order of those three is the specification — timer,
 * move, pick up, deliver, follow — and splitting them across components would put that order at
 * the mercy of document order.
 */
export class Carrier extends Component<Mesh> {
  /** How close the player must be to a crate to take it. */
  pickupRadius = 1;
  /** How close to the origin the player must be to bank the stack. */
  depotRadius = 2;
  /** Vertical gap between stacked crates. */
  spacing = 0.62;
  /** Where the bottom of the stack sits, above the player's centre. */
  liftOff = 0.31;

  private round!: Round;
  private player!: Player;
  private readonly stack: Mesh[] = [];

  override start(): void {
    this.round = this.scene!.findObjectOfType(Round)!;
    this.player = this.scene!.findObjectOfType(Player)!;
  }

  /**
   * `lateUpdate`, so the stack is placed after the player has finished moving this frame.
   * Carrying it in `update` leaves the crates one frame behind, which is visible.
   */
  override lateUpdate(): void {
    this.follow();
  }

  override update(): void {
    if (!this.round.live) return;
    this.collect();
    this.deliver();
  }

  private collect(): void {
    const player = this.player.object3D.position;
    for (const crate of this.scene!.findObjectsOfType(Crate)) {
      const node = crate.object3D;
      if (this.stack.includes(node)) continue;
      if (distanceXZ(node.position, player) >= this.pickupRadius) continue;
      this.stack.push(node);
      this.round.take();
    }
  }

  private deliver(): void {
    if (this.stack.length === 0) return;
    if (distanceXZ(this.player.object3D.position, ORIGIN) >= this.depotRadius) return;

    this.round.bank();
    for (const crate of this.stack) crate.destroy();
    this.stack.length = 0;
  }

  private follow(): void {
    const player = this.player.object3D.position;
    for (const [index, crate] of this.stack.entries()) {
      crate.position.set(
        player.x,
        player.y + 0.8 + this.liftOff + index * this.spacing,
        player.z,
      );
    }
  }
}

const ORIGIN = new Vector3();

/** Distance on the ground plane. Height never decides whether something is within reach. */
function distanceXZ(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
