import type { InputManager } from '@scenoco-three/core';
import type { CameraRig } from './cameraRig.js';

/**
 * Desktop fly navigation via `engine.input` (Unity scene-view style):
 *   • hold RIGHT mouse to look · WASD move · Q/E down/up · Shift faster · wheel speed.
 */
export class DesktopControls {
  private readonly look = 0.0025; // radians per pixel

  constructor(
    private readonly rig: CameraRig,
    private readonly input: InputManager,
  ) {}

  /** Advance one frame (call after `engine.tick`). */
  update(dt: number): void {
    const { input, rig } = this;

    const wheel = input.mouseScrollDelta.y;
    if (wheel !== 0) rig.speed = clamp(rig.speed * (wheel < 0 ? 1.1 : 1 / 1.1), 0.05, 1000);

    if (input.getMouseButton(1)) {
      const d = input.mouseDelta;
      rig.rotate(-d.x * this.look, -d.y * this.look);
    }

    const right = axis(input.getKey('D'), input.getKey('A'));
    const up = axis(input.getKey('E'), input.getKey('Q'));
    const forward = axis(input.getKey('W'), input.getKey('S'));
    if (right || up || forward) {
      const len = Math.hypot(right, up, forward);
      const step = (rig.speed * (input.getKey('LeftShift') ? 4 : 1) * dt) / len;
      rig.move(right * step, up * step, forward * step);
    }
  }
}

function axis(pos: boolean, neg: boolean): number {
  return (pos ? 1 : 0) - (neg ? 1 : 0);
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
