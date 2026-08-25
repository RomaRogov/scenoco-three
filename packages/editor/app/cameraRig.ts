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
   * fast when far. Set by `frameOn`; dolly shrinks/grows it.
   */
  focusDistance: number;

  private readonly q = new Quaternion();
  private readonly v = new Vector3();

  /** Where a focus glide is taking the camera, while one is running. */
  private glideTo: Vector3 | null = null;

  readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, target: Vector3) {
    this.camera = camera;
    camera.lookAt(target);
    this.euler.setFromQuaternion(camera.quaternion);
    this.speed = Math.max(1, camera.position.distanceTo(target) * 0.5);
    this.focusDistance = Math.max(0.1, camera.position.distanceTo(target));
  }

  /**
   * Frame a point: keep looking exactly the way you are, and move until it is centred
   * `distance` away.
   *
   * This is Unity's F, and the angle is the whole of it. Turning to face the selection instead
   * throws away the view the person spent their time arranging — they lined the scene up from
   * one side, pressed F to get closer to a node, and now they are looking at it from wherever
   * the pivot maths decided. Keeping the orientation means F only ever answers "put that in
   * front of me", which is the question it was asked.
   *
   * The camera glides rather than teleports: a cut leaves you working out where you ended up,
   * and the motion is what tells you the scene did not change — only your seat.
   */
  frameOn(point: Vector3, distance: number): void {
    this.focusDistance = Math.max(0.1, distance);
    // Straight back along the current view direction — `-Z` in camera space, which is where the
    // camera already looks, so nothing about the orientation moves.
    this.glideTo = point.clone().addScaledVector(this.forward(this.v), -this.focusDistance);
    this.speed = Math.max(1, this.focusDistance * 0.5); // fly speed scales with how far out we sit
  }

  /** The unit vector the camera currently looks along. */
  private forward(into: Vector3): Vector3 {
    return into.set(0, 0, -1).applyQuaternion(this.q.setFromEuler(this.euler));
  }

  /** Add yaw/pitch in radians (pitch clamped to avoid flipping). */
  rotate(dYaw: number, dPitch: number): void {
    this.glideTo = null; // the person is driving now
    this.euler.y += dYaw;
    this.euler.x = clamp(this.euler.x + dPitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  /**
   * Translate: `right` and `forward` in camera-local space, `up` along **world** up.
   *
   * Local up is the tempting reading and the wrong one. With the camera pitched down at the
   * scene — which is where an editor camera spends its life — a local "up" also carries you
   * backwards, so Q and E slide the view around instead of raising and lowering it. Unity's scene
   * camera uses world up for the same reason.
   */
  move(right: number, up: number, forward: number): void {
    this.glideTo = null; // any input cancels a focus glide — the camera has one owner at a time
    this.v.set(right, 0, -forward).applyQuaternion(this.q.setFromEuler(this.euler));
    this.v.y += up;
    this.camera.position.add(this.v);
  }

  /**
   * Apply the orientation, and advance a focus glide. Call once per frame, after input.
   *
   * Frame-rate independent easing: the *fraction of the remaining distance* covered per second
   * is fixed, so the same glide takes the same time at 60Hz and at 144Hz. `1 - k ** dt` is the
   * exponential form of that — the naive `lerp(a, b, 0.1)` per frame is twice as fast on a
   * 120Hz display, which is how a smooth camera on one machine becomes a snap on another.
   */
  sync(dt = 0): void {
    this.camera.quaternion.setFromEuler(this.euler);
    if (!this.glideTo) return;
    const remaining = this.v.subVectors(this.glideTo, this.camera.position);
    // Close enough that another frame of easing would be invisible: land exactly and stop, so
    // the camera is never left a hair off with a live tween attached to it.
    if (remaining.lengthSq() < 1e-8) {
      this.camera.position.copy(this.glideTo);
      this.glideTo = null;
      return;
    }
    this.camera.position.addScaledVector(remaining, 1 - GLIDE_LEFT_PER_SECOND ** dt);
  }
}

/**
 * The fraction of the distance to the focus target still left after one second.
 *
 * Measured rather than guessed: at 1e-6 the camera is 94% of the way there in 0.2s and 98.5% in
 * 0.3s, so the move reads as quick and decisive and is visually over in about a third of a
 * second. Ten times gentler (1e-5) drifts long enough to feel laggy on a phone; ten times
 * sharper is indistinguishable from a cut.
 */
const GLIDE_LEFT_PER_SECOND = 1e-6;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
