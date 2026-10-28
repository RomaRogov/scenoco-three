import { Euler, Vector3, type Camera } from 'three';

/** Keys that fly, as Unity's: held with the right button, or the arrows on their own. */
const FLY: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1],
  KeyS: [0, 0, -1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyQ: [0, -1, 0],
  KeyE: [0, 1, 0],
};
const ARROWS: Record<string, [number, number, number]> = {
  ArrowUp: [0, 0, 1],
  ArrowDown: [0, 0, -1],
  ArrowLeft: [-1, 0, 0],
  ArrowRight: [1, 0, 0],
};

/**
 * Unity's flythrough mode for the editor's camera: hold the right button to look around, and while
 * it is held W A S D move, Q and E go down and up, Shift is faster and the wheel sets the speed. The
 * arrows move without the button. Speed follows how far away the orbit's target is, so a small
 * scene and a large one both fly at a sensible pace.
 *
 * Orbit controls own the camera the rest of the time; while flying they are off, and when the
 * button is let go their target is put ahead of the camera again, where it now looks.
 */
export class Flythrough {
  enabled = false;
  /** While the right button is held. */
  flying = false;
  private held = new Set<string>();
  private fast = false;
  private boost = 1;
  private reach = 10;
  private look = new Euler(0, 0, 0, 'YXZ');

  private camera: Camera;
  private element: HTMLElement;
  private orbit: { enabled: boolean; target: Vector3 };

  constructor(camera: Camera, element: HTMLElement, orbit: { enabled: boolean; target: Vector3 }) {
    this.camera = camera;
    this.element = element;
    this.orbit = orbit;
    // Capture, so each runs before the orbit controls' own handler and the game's.
    element.addEventListener('pointerdown', this.down, true);
    element.addEventListener('pointermove', this.move);
    element.addEventListener('pointerup', this.up);
    element.addEventListener('lostpointercapture', this.end);
    element.addEventListener('wheel', this.wheel, { capture: true, passive: false });
    element.addEventListener('contextmenu', this.menu);
    addEventListener('keydown', this.key, true);
    addEventListener('keyup', this.key, true);
    addEventListener('blur', this.end);
  }

  /** Moves the camera by the keys held; true while it moves. */
  update(dt: number): boolean {
    const way = new Vector3();
    for (const code of this.held) {
      const step = (this.flying && FLY[code]) || ARROWS[code];
      if (step) way.add(new Vector3(...step));
    }
    if (!this.enabled || way.lengthSq() === 0) return false;
    // The camera looks down its -Z: forward is -Z, up is world up, as Unity's Q and E.
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const by = right.multiplyScalar(way.x).add(forward.multiplyScalar(way.z)).add(new Vector3(0, way.y, 0));
    by.normalize().multiplyScalar(Math.max(this.reach, 1) * this.boost * (this.fast ? 4 : 1) * dt);
    this.camera.position.add(by);
    if (!this.flying) this.orbit.target.add(by);
    return true;
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.down, true);
    this.element.removeEventListener('pointermove', this.move);
    this.element.removeEventListener('pointerup', this.up);
    this.element.removeEventListener('lostpointercapture', this.end);
    this.element.removeEventListener('wheel', this.wheel, true);
    this.element.removeEventListener('contextmenu', this.menu);
    removeEventListener('keydown', this.key, true);
    removeEventListener('keyup', this.key, true);
    removeEventListener('blur', this.end);
  }

  private down = (event: PointerEvent) => {
    if (!this.enabled || event.button !== 2 || event.pointerType !== 'mouse') return;
    this.flying = true;
    this.reach = this.camera.position.distanceTo(this.orbit.target);
    this.orbit.enabled = false;
    this.element.setPointerCapture(event.pointerId);
    event.stopImmediatePropagation();
  };

  private move = (event: PointerEvent) => {
    if (!this.flying) return;
    this.look.setFromQuaternion(this.camera.quaternion);
    this.look.y -= event.movementX * 0.004;
    this.look.x = Math.max(-1.55, Math.min(1.55, this.look.x - event.movementY * 0.004));
    this.look.z = 0;
    this.camera.quaternion.setFromEuler(this.look);
  };

  private up = (event: PointerEvent) => {
    if (event.button === 2) this.end();
  };

  private end = () => {
    for (const code of this.held) if (FLY[code]) this.held.delete(code);
    if (!this.flying) return;
    this.flying = false;
    this.orbit.target.copy(this.camera.position).add(new Vector3(0, 0, -this.reach).applyQuaternion(this.camera.quaternion));
    this.orbit.enabled = this.enabled;
  };

  private wheel = (event: WheelEvent) => {
    if (!this.flying) return;
    this.boost = Math.max(0.05, Math.min(20, this.boost * (event.deltaY < 0 ? 1.2 : 1 / 1.2)));
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private menu = (event: Event) => {
    if (this.enabled) event.preventDefault();
  };

  private key = (event: KeyboardEvent) => {
    this.fast = event.shiftKey;
    if (event.type === 'keyup') {
      this.held.delete(event.code);
      return;
    }
    // Only W A S D Q E while flying, so they are the gizmo's W E R the rest of the time; the arrows
    // only when no field has the keyboard.
    const typing = (event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
    if (!this.enabled || !((this.flying && FLY[event.code]) || (!typing && ARROWS[event.code]))) return;
    this.held.add(event.code);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
}
