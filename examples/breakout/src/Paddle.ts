import { Vector3 } from 'three';
import type { Camera, Mesh } from 'three';
import { Component, Input, KeyCode, MouseButton } from '@scenoco-three/core';

/**
 * Moves the paddle, by keyboard or by dragging.
 *
 * A drag beats the keys while it is held, because a finger on a phone is the only control there
 * is. The pointer's screen x is unprojected through the scene's own camera rather than scaled by
 * a guessed constant, so an edge-to-edge swipe reaches the paddle's actual limits whatever the
 * camera is doing — which matters here, since `FitCamera` moves it about with the aspect ratio.
 */
export class Paddle extends Component<Mesh> {
  /** Units per second, for the keyboard. */
  speed = 14;

  /** How far from the centre it may travel, in world units. */
  halfRange = 7.4;

  private readonly point = new Vector3();
  private readonly eye = new Vector3();

  override update(dt: number): void {
    const camera = this.scene?.mainCamera;
    if (Input.getMouseButton(MouseButton.Left) && camera) {
      this.object3D.position.x = clamp(this.pointerX(camera), -this.halfRange, this.halfRange);
      return;
    }

    const direction =
      (Input.getKey(KeyCode.D) || Input.getKey(KeyCode.RightArrow) ? 1 : 0) -
      (Input.getKey(KeyCode.A) || Input.getKey(KeyCode.LeftArrow) ? 1 : 0);
    if (direction === 0) return;
    const x = this.object3D.position.x + direction * this.speed * dt;
    this.object3D.position.x = clamp(x, -this.halfRange, this.halfRange);
  }

  /**
   * Where the pointer is on the plane the game is played on.
   *
   * Unprojecting alone is not enough: it gives a point at some depth between the near and far
   * planes, and under a perspective camera x grows with depth — so using it directly makes the
   * paddle lag the finger near the top of the screen and overshoot near the bottom. What is
   * wanted is where the ray through the pointer crosses `z = 0`, which is one more step.
   */
  private pointerX(camera: Camera): number {
    this.point.set(Input.pointer.x, Input.pointer.y, 0.5).unproject(camera);
    camera.getWorldPosition(this.eye);
    const direction = this.point.sub(this.eye);
    if (Math.abs(direction.z) < 1e-6) return this.object3D.position.x; // looking along the plane
    const distance = -this.eye.z / direction.z;
    return this.eye.x + direction.x * distance;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
