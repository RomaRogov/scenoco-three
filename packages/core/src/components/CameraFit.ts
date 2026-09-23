import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3, type Camera } from 'three';
import { Component } from '../runtime/Component.js';
import { Engine } from '../runtime/Engine.js';

/** How a fitted camera resolves a frame that does not match the canvas's shape. */
export type FitMode =
  /** Show the whole frame, letterboxing whichever axis has slack. */
  | 'contain'
  /** Fill the canvas with the frame, cropping the axis that does not fit. */
  | 'cover'
  /** Show exactly `width` across, whatever that makes the height. */
  | 'width'
  /** Show exactly `height` down, whatever that makes the width. */
  | 'height';

/**
 * Keep a frame of the world on screen whatever shape the window is — a playfield of so many
 * units by so many, against a canvas the browser sizes.
 *
 * With this attached the projection is **derived**: a perspective camera's `fov` and an
 * orthographic camera's frustum are recomputed on every shape change, overwriting whatever they
 * were authored as. The frame is the authored value now.
 */
export class CameraFit extends Component<Camera> {
  mode: FitMode = 'contain';

  /** The frame's width in world units. Ignored by `mode="height"`. */
  width = 0;
  /** The frame's height in world units. Ignored by `mode="width"`. */
  height = 0;

  /**
   * How far in front of a perspective camera the frame sits. Defaults to the camera's distance
   * from the world origin. Orthographic cameras ignore it.
   */
  distance = 0;

  private lastAspect = 0;
  private readonly worldPosition = new Vector3();

  /**
   * The shape of the frame this camera keeps whole on screen — `width / height` — when it
   * letterboxes; `null` when nothing is boxed in.
   *
   * Only `contain` with both sides set promises a box: the frame sits centred, and the slack on
   * the long axis shows more world rather than bars. That slack is scenery, not screen, so
   * anything laid out *against the screen* — a screen-space UI under this camera — reads this and
   * stays inside the frame. Without it a portrait game's HUD stretched across a wide window while
   * its world stayed a column.
   */
  get frameAspect(): number | null {
    return this.mode === 'contain' && this.width > 0 && this.height > 0 ? this.width / this.height : null;
  }

  override start(): void {
    this.fit();
  }

  /**
   * Polled rather than driven by a resize event: the aspect can change without one — a canvas
   * in a resizable panel — and the check is two reads and a compare.
   */
  override lateUpdate(): void {
    this.fit();
  }

  /** Recompute the projection now. Returns true when it changed. */
  fit(): boolean {
    const aspect = aspectOf();
    if (aspect === undefined || aspect === this.lastAspect) return false;
    this.lastAspect = aspect;

    const height = this.frameHeight(aspect);
    if (height === undefined || height <= 0) return false;
    const camera = this.object3D;

    if (camera instanceof PerspectiveCamera) {
      const distance =
        this.distance > 0 ? this.distance : camera.getWorldPosition(this.worldPosition).length();
      if (distance <= 0) return false;
      camera.fov = 2 * Math.atan(height / 2 / distance) * MathUtils.RAD2DEG;
      camera.updateProjectionMatrix();
      return true;
    }

    if (camera instanceof OrthographicCamera) {
      // Derived whole, so an authored `left`/`right` is not half-honoured.
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.right = (height * aspect) / 2;
      camera.left = -(height * aspect) / 2;
      camera.updateProjectionMatrix();
      return true;
    }
    return false;
  }

  /**
   * The visible height, in world units, that satisfies the fit at this aspect. Everything
   * reduces to a height — a fov is vertical, an ortho frustum is a height plus the aspect — so
   * `contain` is the taller of what the two axes demand and `cover` the shorter.
   */
  private frameHeight(aspect: number): number | undefined {
    const fromWidth = this.width > 0 ? this.width / aspect : undefined;
    const fromHeight = this.height > 0 ? this.height : undefined;

    switch (this.mode) {
      case 'width':
        return fromWidth;
      case 'height':
        return fromHeight;
      case 'contain':
        // One of the two may be unstated, and then the other decides.
        if (fromWidth === undefined || fromHeight === undefined) return fromWidth ?? fromHeight;
        return Math.max(fromWidth, fromHeight);
      case 'cover':
        if (fromWidth === undefined || fromHeight === undefined) return fromWidth ?? fromHeight;
        return Math.min(fromWidth, fromHeight);
    }
  }
}

/** The canvas's aspect ratio, or undefined where there is no canvas to ask. */
function aspectOf(): number | undefined {
  const engine = Engine.current;
  if (!engine) return undefined;
  const { clientWidth, clientHeight } = engine.canvas;
  if (clientWidth <= 0 || clientHeight <= 0) return undefined;
  return clientWidth / clientHeight;
}
