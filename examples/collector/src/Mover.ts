import { MathUtils, Vector3 } from 'three';
import { Component } from '@scenoco-three/core';
import { Joystick } from './Joystick.js';

/**
 * Walks where the stick says, and turns to face the way it is going.
 *
 * Top-down, so the stick's y drives world z. The turn is eased rather than snapped: a character
 * that pivots instantly reads as a sprite, and one frame of lag is the difference.
 */
export class Mover extends Component {
  /** Wired by `#id` — the joystick living on the camera. */
  stick!: Joystick;

  speed = 6;
  /** Degrees a second the model turns towards its heading. */
  turn = 720;
  /** Half the play area, so nobody walks off the level. */
  bounds = new Vector3(7.5, 0, 7.5);

  /** True while the stick is pushed — the animation and the carrier both read it. */
  moving = false;

  override update(dt: number): void {
    const { x, y } = this.stick.direction;
    this.moving = x !== 0 || y !== 0;
    if (!this.moving) return;

    const node = this.object3D;
    node.position.x = MathUtils.clamp(node.position.x + x * this.speed * dt, -this.bounds.x, this.bounds.x);
    node.position.z = MathUtils.clamp(node.position.z - y * this.speed * dt, -this.bounds.z, this.bounds.z);

    // `rotation` and not `eulerAngles`: the degrees view is refreshed from `rotation` on every
    // read, so writing one of its components sets a field the next read discards.
    const wanted = Math.atan2(x, -y);
    const step = MathUtils.degToRad(this.turn) * dt;
    let delta = wanted - node.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    node.rotation.y += MathUtils.clamp(delta, -step, step);
  }
}
