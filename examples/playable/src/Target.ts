import { MathUtils } from 'three';
import { Component } from '@scenoco-three/core';
import { Round } from './Round.js';
import './taps.js';

/**
 * A thing to tap. Spins so it reads as alive, pops when hit.
 *
 * `onTap` is the hook the `Pointer` system dispatches — typed, because the interface it comes
 * from is merged onto `Component`.
 */
export class Target extends Component {
  points = 1;
  spin = 90;

  private round!: Round;

  override awake(): void {
    this.round = this.requireSystem(Round);
  }

  override update(dt: number): void {
    // `rotation` and not `eulerAngles`: the degrees view is refreshed from `rotation` on every
    // read, so writing one of its components sets a field the next read throws away. Assign the
    // whole vector, or turn the handle three.js actually keeps — which is this one, in radians.
    this.object3D.rotation.y += MathUtils.degToRad(this.spin) * dt;
  }

  override onTap(): void {
    this.round.hit(this.points);
    this.object3D.destroy();
  }
}
