import { MathUtils, OrthographicCamera, PerspectiveCamera } from 'three';

const { DEG2RAD, RAD2DEG } = MathUtils;

/**
 * How a fit-enabled camera's frustum adapts to the canvas's aspect ratio,
 * relative to `designWidth`/`designHeight` — Unity's "reference resolution" /
 * Cocos's "design resolution" idea, generalized to work for both camera types.
 * World units for an `OrthographicCamera`; for a `PerspectiveCamera` only their
 * **ratio** matters (perspective framing is scale-invariant with distance — see
 * `applyCameraFit`).
 *
 * - `none`    — no adjustment: the camera's authored fov / left-right-top-bottom
 *               apply completely unchanged. Opt out of fitting entirely, for a
 *               camera whose framing is already exactly what you want on every
 *               aspect (or one you drive yourself).
 * - `width`   — the design width is always exactly what's visible; the height
 *               varies with aspect (may show more or less than designHeight).
 * - `height`  — the design height is always exactly what's visible; width varies.
 * - `contain` — the default: whichever of width/height needs the more
 *               conservative (zoomed out) framing to keep **both** fully visible
 *               — the whole design region is always on screen; the other axis may
 *               show extra (letterboxing), never cropped. "ShowAll" / "fit both".
 * - `cover`   — the opposite: whichever framing fills the screen completely,
 *               cropping outside the design region on the non-binding axis.
 */
export const CAMERA_FIT_MODES = ['none', 'width', 'height', 'contain', 'cover'] as const;
export type CameraFitModeName = (typeof CAMERA_FIT_MODES)[number];

/** Per-camera fit config, stashed on `camera.userData.fit` by the node's `build()`. */
export interface CameraFitConfig {
  mode: CameraFitModeName;
  designWidth: number;
  designHeight: number;
}

interface FitUserData {
  fit?: CameraFitConfig;
  /** The author-set `fov` at build time — `width`/`contain`/`cover` derive a new
   *  `camera.fov` per aspect, so the original has to survive being overwritten. */
  baseFov?: number;
  /** Last aspect this was computed for, so an unchanged aspect is a no-op. */
  _fitAspect?: number;
}

/**
 * Apply a camera's `fit` config (if any) for the current canvas `aspect`
 * (width/height) — cheap to call every tick; it only touches the projection
 * when the aspect actually changed since the last call. No-op for a camera with
 * no `fit` configured (`mode: 'none'` or absent), an invalid design size, or a
 * camera type this doesn't know how to fit.
 */
export function applyCameraFit(camera: PerspectiveCamera | OrthographicCamera, aspect: number): void {
  const data = camera.userData as FitUserData;
  const config = data.fit;
  if (!config || config.mode === 'none' || config.designWidth <= 0 || config.designHeight <= 0) return;
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  if (data._fitAspect === aspect) return; // already applied for this aspect
  data._fitAspect = aspect;

  const designAspect = config.designWidth / config.designHeight;
  // Resolve contain/cover to a concrete width|height binding for *this* aspect —
  // re-evaluated every call, so an orientation change (aspect flips) picks the
  // right axis again, not whatever it resolved to last time.
  const canvasWiderThanDesign = aspect > designAspect;
  let mode = config.mode;
  if (mode === 'contain') mode = canvasWiderThanDesign ? 'height' : 'width';
  else if (mode === 'cover') mode = canvasWiderThanDesign ? 'width' : 'height';

  if (camera instanceof OrthographicCamera) {
    let halfWidth = config.designWidth / 2;
    let halfHeight = config.designHeight / 2;
    if (mode === 'height') halfWidth = halfHeight * aspect;
    else halfHeight = halfWidth / aspect; // mode === 'width'
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    return;
  }

  // Perspective: `fov` is vertical FOV; horizontal FOV is purely a function of it
  // and aspect (hFov = 2·atan(tan(vFov/2)·aspect)) — no distance/position needed,
  // and the camera's own pose (position/rotation, author-set) is never touched.
  const baseVFovRad = (data.baseFov ?? camera.fov) * DEG2RAD;
  if (mode === 'height') {
    camera.fov = baseVFovRad * RAD2DEG; // unchanged — vFov already *is* the height framing
  } else {
    // 'width': hold the hFov the design implies at designAspect, at the CURRENT
    // aspect instead — re-derive the vFov that produces the same horizontal extent.
    const targetHFov = 2 * Math.atan(Math.tan(baseVFovRad / 2) * designAspect);
    camera.fov = 2 * Math.atan(Math.tan(targetHFov / 2) / aspect) * RAD2DEG;
  }
  camera.updateProjectionMatrix();
}
