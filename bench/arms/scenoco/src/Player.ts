import { Vector2, type Mesh } from 'three';
import { Component } from '@scenoco-three/core';
import { Round } from './Round.js';

/**
 * The capsule, and the only thing that moves under its own power.
 *
 * `move` is written by whoever is driving — the keyboard binding in the browser, the test
 * harness in Node — and read here. Keeping the reader out of this class is what lets the same
 * component run in both places without a branch on the environment.
 */
export class Player extends Component<Mesh> {
  /** Units per second. */
  speed = 6;
  /** How far from the centre the capsule may travel on each axis. */
  bounds = 9.5;

  /** Desired direction this frame, length ≤ 1. Screen-up is −Z. */
  readonly move = new Vector2();

  private round!: Round;

  override start(): void {
    this.round = this.scene!.findObjectOfType(Round)!;
  }

  override update(dt: number): void {
    if (!this.round.live) return;

    // Clamped rather than normalised: a half-pushed stick should move at half speed, and a stick
    // pushed into a corner should not move faster than one pushed straight.
    const length = this.move.length();
    const scale = length > 1 ? 1 / length : 1;

    const position = this.object3D.position;
    position.x += this.move.x * scale * this.speed * dt;
    position.z += -this.move.y * scale * this.speed * dt;
    position.x = Math.max(-this.bounds, Math.min(this.bounds, position.x));
    position.z = Math.max(-this.bounds, Math.min(this.bounds, position.z));
  }
}
