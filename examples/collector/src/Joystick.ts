import { Vector2 } from 'three';
import { Component, Input, MouseButton } from '@scenoco-three/core';
import type { Panel } from '@scenoco-three/ui';

/**
 * A floating touch joystick: press anywhere, drag to steer.
 *
 * Two `<Panel>` elements moved every frame. A UI element is a class and its attributes are its
 * properties, so moving one is assigning to it — `base.x = 120` — exactly the rule every other
 * node follows. Pixels all the way through, because that is what a thumb is measured in and what
 * `Input.mousePosition` already reports; nothing has to know about the camera.
 *
 * `direction` is what everything else reads: y points away from the camera, which is what a
 * top-down mover wants.
 */
export class Joystick extends Component {
  /** The ring that marks where the thumb went down. */
  base!: Panel;
  /** The knob that follows it. */
  knob!: Panel;

  /** Full deflection, in pixels from where the thumb landed. */
  reach = 70;
  /** Movement under this fraction of `reach` is treated as still. */
  deadZone = 0.12;

  /** Where the player is being steered. Zero when nothing is held. */
  readonly direction = new Vector2();

  private readonly origin = new Vector2();
  private held = false;

  override start(): void {
    this.show(false);
  }

  override update(): void {
    if (Input.getMouseButtonDown(MouseButton.Left)) {
      this.held = true;
      this.origin.copy(Input.mousePosition);
      this.show(true);
      this.centre(this.base, this.origin.x, this.origin.y);
      this.centre(this.knob, this.origin.x, this.origin.y);
    }
    if (!this.held) return;

    if (!Input.getMouseButton(MouseButton.Left)) {
      this.held = false;
      this.direction.set(0, 0);
      this.show(false);
      return;
    }

    const dx = Input.mousePosition.x - this.origin.x;
    const dy = Input.mousePosition.y - this.origin.y;
    const distance = Math.hypot(dx, dy);
    const clamped = Math.min(distance, this.reach);
    const strength = distance < this.reach * this.deadZone ? 0 : clamped / this.reach;

    // Screen y grows downward and the world's forward runs away from the camera, so the vertical
    // axis is negated exactly once — here — and every reader gets the sign it expects.
    if (distance > 0) this.direction.set((dx / distance) * strength, (-dy / distance) * strength);
    else this.direction.set(0, 0);

    // The knob rides to the rim and no further, which is what tells a thumb it has reached full
    // speed.
    const ride = distance > 0 ? clamped / distance : 0;
    this.centre(this.knob, this.origin.x + dx * ride, this.origin.y + dy * ride);
  }

  private show(visible: boolean): void {
    this.base.setActive(visible);
    this.knob.setActive(visible);
  }

  /** Put a panel's middle at a point on screen. `x`/`y` are its top-left inset. */
  private centre(panel: Panel, x: number, y: number): void {
    panel.x = x - (panel.width ?? 0) / 2;
    panel.y = y - (panel.height ?? 0) / 2;
  }
}
