import { Vector2 } from 'three';
import type { CameraRig } from './cameraRig.js';

/**
 * Touch navigation for mobile 3D editing (HypeHype-style):
 *   • one finger drag  → pan the camera up/down/left/right (like Q/E/A/D)
 *   • two finger drag  → rotate (look) with the two-finger movement
 *   • two finger pinch → dolly forward / back
 *
 * Event-driven (touchmove drives the rig directly); coexists with the desktop
 * controls because both only ever call `rig` verbs.
 */
export class TouchControls {
  private readonly points = new Map<number, Vector2>();
  private prevPinch = 0;
  // Per-pixel factors, multiplied by the focus distance (Unity-like): drag/dolly
  // feel the same on screen at any zoom — fine up close, fast when far away.
  private readonly pan = 0.0016;
  private readonly dolly = 0.005;
  private readonly look = 0.005; // radians per pixel
  private detach: Array<() => void> = [];

  constructor(
    private readonly rig: CameraRig,
    canvas: HTMLElement,
    /** When true, a gizmo handle owns the gesture — leave the camera alone. */
    private readonly isBlocked: () => boolean = () => false,
  ) {
    const on = (type: string, fn: (e: TouchEvent) => void) => {
      const h = fn as EventListener;
      canvas.addEventListener(type, h, { passive: false });
      this.detach.push(() => canvas.removeEventListener(type, h));
    };
    on('touchstart', this.onStart);
    on('touchmove', this.onMove);
    on('touchend', this.onEnd);
    on('touchcancel', this.onEnd);
  }

  private onStart = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.points.set(t.identifier, new Vector2(t.clientX, t.clientY));
    this.prevPinch = this.pinchDistance();
  };

  private onMove = (e: TouchEvent): void => {
    // A single finger dragging a gizmo handle also emits touch events — yield it.
    if (this.points.size === 1 && this.isBlocked()) return;
    e.preventDefault();
    const k = this.rig.focusDistance;
    if (this.points.size === 1) {
      // One finger → drag the scene: the camera moves *opposite* the finger so the
      // grabbed point follows it. Scaled by focus distance.
      for (const t of Array.from(e.touches)) {
        const prev = this.points.get(t.identifier);
        if (!prev) continue;
        this.rig.move(-(t.clientX - prev.x) * this.pan * k, (t.clientY - prev.y) * this.pan * k, 0);
        prev.set(t.clientX, t.clientY);
      }
    } else if (this.points.size >= 2) {
      // Two fingers → rotate by the average movement, dolly by the pinch change.
      let dx = 0;
      let dy = 0;
      let n = 0;
      for (const t of Array.from(e.touches)) {
        const prev = this.points.get(t.identifier);
        if (!prev) continue;
        dx += t.clientX - prev.x;
        dy += t.clientY - prev.y;
        prev.set(t.clientX, t.clientY);
        n++;
      }
      if (n > 0) this.rig.rotate((-dx / n) * this.look, (-dy / n) * this.look);

      const pinch = this.pinchDistance();
      if (this.prevPinch > 0) {
        const forward = (pinch - this.prevPinch) * this.dolly * k;
        this.rig.move(0, 0, forward);
        this.rig.focusDistance = Math.max(0.1, this.rig.focusDistance - forward); // dollied closer → finer
      }
      this.prevPinch = pinch;
    }
  };

  private onEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) this.points.delete(t.identifier);
    this.prevPinch = this.pinchDistance();
  };

  private pinchDistance(): number {
    const pts = [...this.points.values()];
    return pts.length >= 2 ? pts[0]!.distanceTo(pts[1]!) : 0;
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach = [];
  }
}

/** True on a touch-capable device. */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
}
