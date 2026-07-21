import { Vector3 } from 'three';
import { Component, component, property, ValueType } from '@scenoco-three/core';

/**
 * Moves the paddle left/right — keyboard/gamepad (`Horizontal` virtual axis,
 * already blends arrow keys, A/D, and a gamepad's left stick), **or** by
 * dragging: while the mouse/touch button is held, the paddle follows the
 * pointer's world-space position directly (unprojected through the active
 * camera, not a hardcoded scale — correct regardless of the camera's current
 * zoom/frustum, e.g. `ResponsiveCamera` refitting it per aspect ratio). A single
 * touch is already reported as mouse button 0 by the engine's input layer
 * (`InputManager`), so this one code path drives mouse-drag on desktop and
 * finger-drag on mobile with no extra per-platform branching. Clamps the paddle
 * within the field half-range so it never overlaps the walls either way.
 */
@component({
  name: 'PaddleController',
  description: 'Moves the Breakout paddle left/right with arrow keys, WASD, a gamepad, or drag (mouse/touch)',
})
export class PaddleController extends Component {
  @property({ type: ValueType.Float, description: 'Paddle speed in units per second (keyboard/gamepad only)' })
  speed = 10;

  @property({
    type: ValueType.Float,
    description: 'Maximum X distance from the center before the paddle is clamped',
  })
  halfRange = 6.0;

  // Reused across frames so a held drag doesn't allocate one every tick.
  private readonly ndc = new Vector3();

  override update(dt: number): void {
    const input = this.engine.input;
    if (input.getMouseButton(0) && this.engine.mainCamera) {
      // Unproject the pointer's NDC x through the active camera to get its
      // world-space x on the field's plane — exact for whatever the camera's
      // current frustum is, so a screen-edge-to-edge drag always reaches the
      // paddle's actual travel limits, on any aspect ratio.
      this.ndc.set(input.mouseNdc.x, 0, 0).unproject(this.engine.mainCamera);
      this.node.position.x = Math.max(-this.halfRange, Math.min(this.halfRange, this.ndc.x));
      return;
    }
    const dir = input.getAxis('Horizontal');
    if (dir === 0) return;
    this.node.position.x = Math.max(
      -this.halfRange,
      Math.min(this.halfRange, this.node.position.x + dir * this.speed * dt),
    );
  }
}
