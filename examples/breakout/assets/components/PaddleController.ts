import { Component, component, property, ValueType } from '@scenoco-three/core';

/**
 * Moves the paddle left/right from `engine.input` — the `Horizontal` virtual axis
 * already blends arrow keys, A/D, and a gamepad's left stick. Clamps the paddle
 * within the field half-range so it never overlaps the walls.
 */
@component({
  name: 'PaddleController',
  description: 'Moves the Breakout paddle left/right with arrow keys, WASD, or a gamepad',
})
export class PaddleController extends Component {
  @property({ type: ValueType.Float, default: 10, description: 'Paddle speed in units per second' })
  speed = 10;

  @property({
    type: ValueType.Float,
    default: 6.0,
    description: 'Maximum X distance from the center before the paddle is clamped',
  })
  halfRange = 6.0;

  override update(dt: number): void {
    const dir = this.engine.input.getAxis('Horizontal');
    if (dir === 0) return;
    this.node.position.x = Math.max(
      -this.halfRange,
      Math.min(this.halfRange, this.node.position.x + dir * this.speed * dt),
    );
  }
}
