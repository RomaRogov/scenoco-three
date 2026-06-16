import { Component, component, property } from '@scenoco-three/core';

/**
 * Moves the paddle left/right based on keyboard input (Arrows or WASD).
 * Clamps the paddle within the field half-range so it never overlaps the walls.
 */
@component({
  name: 'PaddleController',
  description: 'Moves the Breakout paddle left/right with arrow keys or WASD',
})
export class PaddleController extends Component {
  @property({ type: 'float', default: 10, description: 'Paddle speed in units per second' })
  speed = 10;

  @property({
    type: 'float',
    default: 6.0,
    description: 'Maximum X distance from the center before the paddle is clamped',
  })
  halfRange = 6.0;

  private left = false;
  private right = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.right = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.right = false;
  };

  override onLoad(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  override onDestroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  override update(dt: number): void {
    const dir = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    if (dir === 0) return;
    this.node.position.x = Math.max(
      -this.halfRange,
      Math.min(this.halfRange, this.node.position.x + dir * this.speed * dt),
    );
  }
}
