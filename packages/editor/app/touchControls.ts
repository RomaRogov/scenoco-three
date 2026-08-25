import { Vector2 } from 'three';
import type { CameraRig } from './cameraRig.js';

/**
 * Touch navigation, for editing a scene on a phone or tablet:
 *
 * - **one finger** drags the scene — the camera moves opposite the finger, so whatever is under
 *   it stays under it
 * - **two fingers** turn the view by their average movement, and pinch to dolly in and out
 *
 * One finger pans rather than orbits because the other half of the editor's one-finger vocabulary
 * is already spoken for: a tap selects, and a drag on a gizmo handle moves the thing you selected.
 * Turning is the gesture you reach for least often while placing something, so it gets the
 * two-finger slot.
 *
 * Every motion is scaled by `focusDistance`, which is Unity's trick: a drag covers the same
 * *screen* distance whether you're an arm's length from a crate or across the level, so the
 * controls feel the same at every zoom.
 *
 * It shares the camera with the desktop controls by construction — both only ever call `rig`
 * verbs, and the rig is what writes the transform.
 */
export class TouchControls {
  private readonly points = new Map<number, Vector2>();
  private previousPinch = 0;

  /** Per-pixel rates, multiplied by the focus distance (except look, which is angular). */
  private readonly pan = 0.0016;
  private readonly dolly = 0.005;
  private readonly look = 0.005; // radians per pixel

  private detach: Array<() => void> = [];

  private readonly rig: CameraRig;
  /** True while a gizmo handle owns the gesture — the camera stays out of it. */
  private readonly isBlocked: () => boolean;

  constructor(rig: CameraRig, canvas: HTMLElement, isBlocked: () => boolean = () => false) {
    this.rig = rig;
    this.isBlocked = isBlocked;
    const on = (type: string, handler: (event: TouchEvent) => void): void => {
      const listener = handler as EventListener;
      // Not passive: these gestures have to beat the browser's own pan/zoom, and it only
      // honours `preventDefault` from a listener that said up front it might call it.
      canvas.addEventListener(type, listener, { passive: false });
      this.detach.push(() => canvas.removeEventListener(type, listener));
    };
    on('touchstart', this.onStart);
    on('touchmove', this.onMove);
    on('touchend', this.onEnd);
    on('touchcancel', this.onEnd);
  }

  private onStart = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      this.points.set(touch.identifier, new Vector2(touch.clientX, touch.clientY));
    }
    this.previousPinch = this.pinchDistance();
  };

  private onMove = (event: TouchEvent): void => {
    // A finger dragging a gizmo handle emits touch events too — that gesture belongs to the
    // gizmo, and the camera must hold still under it or the drag fights the view.
    if (this.points.size === 1 && this.isBlocked()) return;
    event.preventDefault();
    const scale = this.rig.focusDistance;

    if (this.points.size === 1) {
      for (const touch of Array.from(event.touches)) {
        const previous = this.points.get(touch.identifier);
        if (!previous) continue;
        this.rig.move(
          -(touch.clientX - previous.x) * this.pan * scale,
          (touch.clientY - previous.y) * this.pan * scale,
          0,
        );
        previous.set(touch.clientX, touch.clientY);
      }
      return;
    }

    let dx = 0;
    let dy = 0;
    let moved = 0;
    for (const touch of Array.from(event.touches)) {
      const previous = this.points.get(touch.identifier);
      if (!previous) continue;
      dx += touch.clientX - previous.x;
      dy += touch.clientY - previous.y;
      previous.set(touch.clientX, touch.clientY);
      moved++;
    }
    // The *average* of the two fingers, so a pinch — where they travel opposite ways — cancels
    // out and dollies without also swinging the view around.
    if (moved > 0) this.rig.rotate((-dx / moved) * this.look, (-dy / moved) * this.look);

    const pinch = this.pinchDistance();
    if (this.previousPinch > 0) {
      const forward = (pinch - this.previousPinch) * this.dolly * scale;
      this.rig.move(0, 0, forward);
      // Closer in means finer control, the same way the wheel tunes fly speed on desktop.
      this.rig.focusDistance = Math.max(0.1, this.rig.focusDistance - forward);
    }
    this.previousPinch = pinch;
  };

  private onEnd = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) this.points.delete(touch.identifier);
    // Lifting one of two fingers must not read as a huge pinch on the next move.
    this.previousPinch = this.pinchDistance();
  };

  private pinchDistance(): number {
    const [a, b] = [...this.points.values()];
    return a && b ? a.distanceTo(b) : 0;
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach = [];
  }
}

/** True on a device that can be touched — which is what decides fat gizmo handles. */
export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}
