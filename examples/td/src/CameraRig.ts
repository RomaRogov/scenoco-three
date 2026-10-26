import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { Behaviour, Event, Input } from '@scenoco-three/core';

/**
 * The level's camera, tilted over the map. It frames `width` units across whatever the screen's
 * shape — a phone held upright sees the whole play area — and the player drags to pan, pinches or
 * scrolls to zoom. A tap (a touch that barely moved) is reported through `onTap` for picking.
 */
export class CameraRig extends Behaviour<PerspectiveCamera> {
  /** Degrees below the horizon. */
  pitch = 52;
  /** Units across the screen at the focus, zoomed out. */
  width = 30;
  /** And at most this much of the map's length, top to bottom, on a wide screen. */
  length = 72;
  /** Where it looks, zoomed out: a little towards the castle, so the HUD covers sky, not the keep. */
  centre: [number, number] = [0, 2.5];
  /** How far the focus may wander from `centre`, x and z, zoomed all the way in. */
  bounds: [number, number] = [12, 22];
  /** Ground height the camera looks at. */
  ground = 0;
  maxZoom = 2.6;

  readonly onTap = new Event<[x: number, y: number]>();

  private readonly focus = new Vector3();
  private zoom = 1;
  private shakeLeft = 0;
  private shakeStrength = 0;
  private readonly pointers = new Map<number, { x: number; y: number; startX: number; startY: number; at: number }>();
  private pinchFrom = 0;
  private zoomFrom = 1;
  private moved = false;
  private canvas: HTMLCanvasElement | null = null;
  private lastTap = 0;

  /** Shake the view: `strength` units, fading over a moment. */
  shake(strength = 0.25) {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeLeft = 0.35;
  }

  override onEnable() {
    this.canvas = document.querySelector('canvas');
    this.canvas?.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
  }

  override onDisable() {
    this.canvas?.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.up);
  }

  override lateUpdate(dt: number) {
    const scroll = Input.mouseScrollDelta.y;
    if (scroll) this.zoom = MathUtils.clamp(this.zoom * Math.exp(-scroll * 0.0015), 1, this.maxZoom);

    const camera = this.node;
    const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const pitch = MathUtils.degToRad(this.pitch);
    // Distance at which `width` fits across, capped so a wide screen still sees no more than `length`.
    const fitWidth = this.width / (2 * tanHalf * camera.aspect);
    const fitLength = (this.length * Math.sin(pitch)) / (2 * tanHalf);
    const distance = Math.min(fitWidth, fitLength) / this.zoom;

    // Zoomed out, the whole area is in view: the focus may only wander as far as the zoom allows.
    const room = 1 - 1 / this.zoom;
    const [cx, cz] = this.centre;
    this.focus.x = MathUtils.clamp(this.focus.x, cx - this.bounds[0] * room, cx + this.bounds[0] * room);
    this.focus.z = MathUtils.clamp(this.focus.z, cz - this.bounds[1] * room, cz + this.bounds[1] * room);

    camera.position.set(this.focus.x, this.ground + Math.sin(pitch) * distance, this.focus.z + Math.cos(pitch) * distance);
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      const s = this.shakeStrength * Math.max(0, this.shakeLeft / 0.35);
      camera.position.x += (Math.random() * 2 - 1) * s;
      camera.position.y += (Math.random() * 2 - 1) * s;
    } else {
      this.shakeStrength = 0;
    }
    camera.lookAt(this.focus.x, this.ground, this.focus.z);
  }

  private down = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, at: performance.now() });
    if (this.pointers.size === 1) this.moved = false;
    if (this.pointers.size === 2) {
      this.pinchFrom = this.spread();
      this.zoomFrom = this.zoom;
      this.moved = true;
    }
  };

  private move = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 10) this.moved = true;
    if (this.pointers.size >= 2) {
      const spread = this.spread();
      if (this.pinchFrom > 0) this.zoom = MathUtils.clamp(this.zoomFrom * (spread / this.pinchFrom), 1, this.maxZoom);
      return;
    }
    if (!this.moved) return;
    // Drag the ground: a screen pixel is this many units at the focus.
    const camera = this.node;
    const perPixel = (2 * this.node.position.distanceTo(new Vector3(this.focus.x, this.ground, this.focus.z)) * Math.tan(MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
    this.focus.x -= dx * perPixel;
    this.focus.z -= (dy * perPixel) / Math.sin(MathUtils.degToRad(this.pitch));
  };

  private up = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p || this.pointers.size > 0) return;
    const now = performance.now();
    // One touch can arrive twice, as a touch and as the mouse a browser makes from it.
    if (this.moved || now - p.at > 500 || now - this.lastTap < 300) return;
    this.lastTap = now;
    this.onTap.emit(e.clientX, e.clientY);
  };

  private spread() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
