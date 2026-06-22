import { Euler, Quaternion, Vector3, type PerspectiveCamera } from 'three';

/**
 * Owns the editor camera's orientation (yaw/pitch, roll-free) and exposes simple
 * verbs that both the desktop (mouse/keyboard) and touch input adapters call, so
 * the two never fight over the camera transform. Call `sync()` once per frame.
 */
export class CameraRig {
  readonly euler = new Euler(0, 0, 0, 'YXZ');
  /** Base movement speed (world units/sec), tuned by the wheel / scene size. */
  speed: number;
  /**
   * Distance to the focus point (Unity scene-camera pivot). Touch pan/dolly scale
   * by this, so motion stays consistent on screen at any zoom — fine near objects,
   * fast when far. Set via `focusOn`; dolly shrinks/grows it.
   */
  focusDistance: number;

  private readonly q = new Quaternion();
  private readonly v = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    target: Vector3,
  ) {
    camera.lookAt(target);
    this.euler.setFromQuaternion(camera.quaternion);
    this.speed = Math.max(1, camera.position.distanceTo(target) * 0.5);
    this.focusDistance = Math.max(0.1, camera.position.distanceTo(target));
  }

  /** Re-pivot on a world point (e.g. the selected node) and reset the focus distance. */
  focusOn(point: Vector3): void {
    this.focusDistance = Math.max(0.1, this.camera.position.distanceTo(point));
  }

  /** Add yaw/pitch in radians (pitch clamped to avoid flipping). */
  rotate(dYaw: number, dPitch: number): void {
    this.euler.y += dYaw;
    this.euler.x = clamp(this.euler.x + dPitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  /** Translate in camera-local space: +x right, +y up, +z forward. */
  move(right: number, up: number, forward: number): void {
    this.v.set(right, up, -forward).applyQuaternion(this.q.setFromEuler(this.euler));
    this.camera.position.add(this.v);
  }

  /** Apply the orientation to the camera. Call once per frame, after input. */
  sync(): void {
    this.camera.quaternion.setFromEuler(this.euler);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
