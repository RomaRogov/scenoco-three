import { Behaviour, Input, type AxisName } from '@scenoco-three/core';

/**
 * A stick on the page — the element `#<element>`, its knob the first child — driving one of Input's
 * axes: dragged sideways, `Horizontal` (or `axis`) reads -1..1 through `Input.getAxis`, the same
 * as the keys; let go, and the axis goes back to the keys (`Input.setAxis(axis, null)`). The finger
 * can wander off the stick and keep steering: the pointer is captured.
 */
export class TouchStick extends Behaviour {
  element = 'stick';
  axis: AxisName = 'Horizontal';
  /** How far the knob travels each way, in CSS pixels: that far is full lock. */
  reach = 56;
  /** Below this, the axis reads 0: a thumb resting off-centre does not steer. */
  deadZone = 0.08;

  private base: HTMLElement | null = null;
  private knob: HTMLElement | null = null;
  private finger: number | null = null;
  private from = 0;

  override awake(): void {
    this.base = document.getElementById(this.element);
    this.knob = (this.base?.firstElementChild as HTMLElement | null) ?? null;
    this.base?.addEventListener('pointerdown', this.down);
    this.base?.addEventListener('pointermove', this.move);
    this.base?.addEventListener('pointerup', this.up);
    this.base?.addEventListener('pointercancel', this.up);
  }

  override onDestroy(): void {
    this.base?.removeEventListener('pointerdown', this.down);
    this.base?.removeEventListener('pointermove', this.move);
    this.base?.removeEventListener('pointerup', this.up);
    this.base?.removeEventListener('pointercancel', this.up);
    if (this.finger !== null) Input.setAxis(this.axis, null);
  }

  private readonly down = (event: PointerEvent): void => {
    if (this.finger !== null || !this.base) return;
    this.finger = event.pointerId;
    this.from = event.clientX;
    this.base.setPointerCapture(event.pointerId);
    // Grabbing the knob where it is, not jumping it under the thumb: the stick starts centred.
    this.set(0);
  };

  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId !== this.finger) return;
    this.set((event.clientX - this.from) / this.reach);
  };

  private readonly up = (event: PointerEvent): void => {
    if (event.pointerId !== this.finger) return;
    this.finger = null;
    if (this.knob) this.knob.style.translate = '0 0';
    Input.setAxis(this.axis, null);
  };

  private set(raw: number): void {
    const value = Math.max(-1, Math.min(1, raw));
    if (this.knob) this.knob.style.translate = `${value * this.reach}px 0`;
    Input.setAxis(this.axis, Math.abs(value) < this.deadZone ? 0 : value);
  }
}
