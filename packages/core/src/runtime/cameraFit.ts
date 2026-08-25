import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3, type Camera } from 'three';
import { Component } from './Component.js';
import { Engine } from './Engine.js';

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
 * Keep a frame of the world on screen whatever shape the window is.
 *
 * A game is authored against a playfield — twenty-one units by nineteen, an arena, a board —
 * and the canvas is whatever the browser gives it. Without a rule for that, the camera keeps
 * the fov it was authored with, the visible height stays fixed, and a narrow window silently
 * crops the sides off the level.
 *
 * ```xml
 * <PerspectiveCamera id="camera" position="y: 8.5; z: 24">
 *   <Components>
 *     <CameraFit mode="contain" width="21" height="19.5" distance="24" />
 *   </Components>
 * </PerspectiveCamera>
 * ```
 *
 * A component rather than attributes on the camera tag, because three.js has no such concept:
 * `camera.fit` would be a SceNoCo idea wearing three.js's clothes, and telling the two apart is
 * the whole reason a document is predictable. Everything the engine adds that three.js has no
 * name for is a class you can see — a component, a system, an effect.
 *
 * With this attached the projection is **derived**: a perspective camera's `fov` and an
 * orthographic camera's frustum are recomputed whenever the canvas changes shape, so whatever
 * they were authored as is overwritten. That is the point — the frame is the authored value now.
 */
export class CameraFit extends Component<Camera> {
  mode: FitMode = 'contain';

  /** The frame's width in world units. Ignored by `mode="height"`. */
  width = 0;
  /** The frame's height in world units. Ignored by `mode="width"`. */
  height = 0;

  /**
   * How far in front of a perspective camera the frame sits. Defaults to the camera's own
   * distance from the world origin, which is right for the usual "camera pulled back from the
   * middle of the level" arrangement. Orthographic cameras ignore it.
   */
  distance = 0;

  private lastAspect = 0;
  private readonly worldPosition = new Vector3();

  override start(): void {
    this.fit();
  }

  /**
   * Checked every frame rather than driven by a resize event: the aspect can change without one
   * — a canvas in a resizable panel, a phone rotating, an editor viewport — and the check is two
   * reads and a compare.
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
      // The frustum is derived whole, so an authored `left`/`right` is not half-honoured: with a
      // fit attached, the frame is the authored value and these four are its consequence.
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
   * The visible height, in world units, that satisfies the fit at this aspect.
   *
   * Everything reduces to a height: a perspective camera's fov is vertical, and an orthographic
   * frustum is a height plus the aspect. So `contain` is "the taller of what the two axes each
   * demand" and `cover` is the shorter one — one line each, and no separate branch per camera.
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
        // One of the two may be unstated, and then the other simply decides — a document that
        // only cares about the height should not have to invent a width.
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
