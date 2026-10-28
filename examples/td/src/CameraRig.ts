import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { Behaviour, Event, Input } from '@scenoco-three/core';

/**
 * The level's camera, tilted over the map. Held upright it frames `width` units across; on a wide
 * screen it turns the map on its side — the lair on the left, the castle on the right — and frames
 * `span`, the map's length, across. Either way the whole play area is in view. The player drags to
 * pan, pinches or scrolls to zoom. A tap (a touch that barely moved) is reported through `onTap`.
 */
export class CameraRig extends Behaviour<PerspectiveCamera> {
  /** Degrees below the horizon. */
  pitch = 52;
  /** Units of the map's width across the screen at the focus, zoomed out, held upright. */
  width = 30;
  /** And units of its length top to bottom: held upright both fit, on a phone or a tablet. */
  length = 72;
  /** Units of the map's length across a wide screen, which sees the map on its side. */
  span = 66;
  /** Where it looks, zoomed out and held upright: a little towards the castle, so the HUD covers sky, not the keep. */
  centre: [number, number] = [0, 2.5];
  /** And on a wide screen, x and z: where the map turned on its side is centred. */
  wideCentre: [number, number] = [0, 0];
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
    this.place(dt);
  }

  /** A field changed in the editor: the camera moves at once, paused or not. */
  override onValidate() {
    this.place(0);
  }

  private place(dt: number) {
    const camera = this.node;
    const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const pitch = MathUtils.degToRad(this.pitch);
    // Upright: far enough for `width` to fit across and `length` top to bottom — a phone's narrow
    // screen is held back by the width, a tablet's by the length. Wide: the map turned a quarter,
    // its length (`span`) across.
    const wide = camera.aspect > 1;
    const fitWidth = this.width / (2 * tanHalf * camera.aspect);
    const fitLength = (this.length * Math.sin(pitch)) / (2 * tanHalf);
    const fitSpan = this.span / (2 * tanHalf * camera.aspect);
    const distance = (wide ? fitSpan : Math.max(fitWidth, fitLength)) / this.zoom;

    // Zoomed out, the whole area is in view: the focus may only wander as far as the zoom allows.
    const room = 1 - 1 / this.zoom;
    const [cx, cz] = wide ? this.wideCentre : this.centre;
    this.focus.x = MathUtils.clamp(this.focus.x, cx - this.bounds[0] * room, cx + this.bounds[0] * room);
    this.focus.z = MathUtils.clamp(this.focus.z, cz - this.bounds[1] * room, cz + this.bounds[1] * room);

    // Upright it looks towards -z (the lair at the top); wide, towards +x (the lair on the left).
    const back = Math.cos(pitch) * distance;
    camera.position.set(this.focus.x - (wide ? back : 0), this.ground + Math.sin(pitch) * distance, this.focus.z + (wide ? 0 : back));
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
    const across = dx * perPixel;
    const along = (dy * perPixel) / Math.sin(MathUtils.degToRad(this.pitch));
    if (camera.aspect > 1) {
      this.focus.z -= across;
      this.focus.x += along;
    } else {
      this.focus.x -= across;
      this.focus.z -= along;
    }
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
