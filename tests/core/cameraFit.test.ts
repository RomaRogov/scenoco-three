import { OrthographicCamera, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { instantiateScene } from '@scenoco-three/core';
import { compileSceneXml } from '@scenoco-three/compiler';
import { applyCameraFit, type CameraFitConfig } from '../../packages/core/src/runtime/cameraFit.js';

function compile(xml: string) {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.scene;
}

/** Set up a bare camera's fit config the way the node's build() does. */
function fitted(camera: PerspectiveCamera | OrthographicCamera, config: CameraFitConfig): void {
  camera.userData.fit = config;
  if (camera instanceof PerspectiveCamera) camera.userData.baseFov = camera.fov;
}

describe('camera fit — DSL wiring', () => {
  it('compiles fit/designWidth/designHeight into userData on both camera types', () => {
    const live = instantiateScene(
      compile(`<Scene>
        <PerspectiveCamera id="persp" fov="50" fit="width" designWidth="10" designHeight="6" />
        <OrthographicCamera id="ortho" fit="contain" designWidth="10" designHeight="6" />
        <PerspectiveCamera id="plain" fit="none" />
      </Scene>`),
    );
    const persp = live.nodes.find((n) => n.sceneId === 'persp') as unknown as PerspectiveCamera;
    expect(persp.userData.fit).toEqual({ mode: 'width', designWidth: 10, designHeight: 6 });
    expect(persp.userData.baseFov).toBe(50); // captured before any resize-driven mutation

    const ortho = live.nodes.find((n) => n.sceneId === 'ortho') as unknown as OrthographicCamera;
    expect(ortho.userData.fit).toEqual({ mode: 'contain', designWidth: 10, designHeight: 6 });

    // `none` opts out, and applyCameraFit must leave the camera untouched — the
    // design size still compiles through (it defaults to 16:9, not 0), so the
    // mode alone is what turns fitting off.
    const plain = live.nodes.find((n) => n.sceneId === 'plain') as unknown as PerspectiveCamera;
    expect(plain.userData.fit).toEqual({ mode: 'none', designWidth: 16, designHeight: 9 });
  });

  // The design size defaults to 16:9 rather than 0 because `applyCameraFit`
  // reads a zero dimension as "not configured" and returns early. Left at 0, a
  // camera authored `fit="contain"` would frame exactly like `none` and nothing
  // would say so — the mode has to mean what it says with no extra attributes.
  it('makes the default fit actually fit, with no design size authored', () => {
    const live = instantiateScene(compile(`<Scene><PerspectiveCamera id="cam" fov="50" fit="contain" /></Scene>`));
    const cam = live.nodes.find((n) => n.sceneId === 'cam') as unknown as PerspectiveCamera;
    expect(cam.userData.fit).toEqual({ mode: 'contain', designWidth: 16, designHeight: 9 });

    // Narrower than 16:9 (a portrait phone) binds on width, so the fov widens to
    // keep the design region's horizontal extent visible instead of cropping it.
    fitted(cam, cam.userData.fit as CameraFitConfig);
    applyCameraFit(cam, 9 / 16);
    expect(cam.fov).toBeGreaterThan(50);
  });
});

describe('camera fit — orthographic', () => {
  it("'none' leaves left/right/top/bottom exactly as authored, regardless of aspect", () => {
    const cam = new OrthographicCamera(-3, 3, 2, -2, 0.1, 100);
    fitted(cam, { mode: 'none', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, 16 / 9);
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-3, 3, 2, -2]);
  });

  it("'width' holds the design width fixed; height grows/shrinks with aspect", () => {
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    fitted(cam, { mode: 'width', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, 2); // wide canvas
    expect(cam.left).toBe(-5);
    expect(cam.right).toBe(5);
    expect(cam.top).toBeCloseTo(2.5); // half-width(5) / aspect(2)
    expect(cam.bottom).toBeCloseTo(-2.5);
  });

  it("'height' holds the design height fixed; width grows/shrinks with aspect", () => {
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    fitted(cam, { mode: 'height', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, 0.5); // portrait canvas
    expect(cam.top).toBe(3);
    expect(cam.bottom).toBe(-3);
    expect(cam.left).toBeCloseTo(-1.5); // half-height(3) * aspect(0.5)
    expect(cam.right).toBeCloseTo(1.5);
  });

  it("'contain' always keeps the whole design region visible (never crops), on any aspect", () => {
    const design = { mode: 'contain' as const, designWidth: 10, designHeight: 6 };
    for (const aspect of [0.3, 0.5, 10 / 6, 1, 16 / 9, 4]) {
      const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      fitted(cam, design);
      applyCameraFit(cam, aspect);
      expect(cam.left).toBeLessThanOrEqual(-5);
      expect(cam.right).toBeGreaterThanOrEqual(5);
      expect(cam.top).toBeGreaterThanOrEqual(3);
      expect(cam.bottom).toBeLessThanOrEqual(-3);
      // And it's a *tight* contain — one axis matches the design exactly (no more
      // zoomed out than necessary).
      const widthTight = cam.right === 5 && cam.left === -5;
      const heightTight = cam.top === 3 && cam.bottom === -3;
      expect(widthTight || heightTight).toBe(true);
    }
  });

  it("'cover' always fills the screen completely (crops instead of letterboxing)", () => {
    // Standard image "cover" convention: when the container is proportionally
    // *narrower* than the content (canvasAspect < designAspect, a portrait
    // screen against this landscape-ish 10×6 design), you fit to HEIGHT and the
    // width overflows/crops — the opposite of 'contain', which would fit WIDTH
    // and show extra height instead.
    const design = { mode: 'cover' as const, designWidth: 10, designHeight: 6 }; // designAspect ≈ 1.67
    const narrow = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    fitted(narrow, design);
    applyCameraFit(narrow, 0.5);
    expect(narrow.top).toBe(3);
    expect(narrow.bottom).toBe(-3); // full design height, uncropped
    expect(narrow.right).toBeLessThan(5); // width cropped below the design width

    // A wide aspect (proportionally wider than design) fits WIDTH instead, and
    // height overflows/crops.
    const wide = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    fitted(wide, design);
    applyCameraFit(wide, 4);
    expect(wide.left).toBe(-5);
    expect(wide.right).toBe(5); // full design width, uncropped
    expect(wide.top).toBeLessThan(3); // height cropped below the design height
  });

  it('re-resolves contain/cover per call — an orientation flip picks the other axis again', () => {
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    fitted(cam, { mode: 'contain', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, 0.5); // portrait: width-bound
    expect(cam.left).toBe(-5);
    applyCameraFit(cam, 4); // rotated to landscape: height-bound now
    expect(cam.top).toBe(3);
    expect(cam.right).toBeGreaterThan(5); // width now shows extra (letterboxed)
  });

  it('is a no-op when re-applied for the same aspect (cheap per-tick call)', () => {
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    fitted(cam, { mode: 'contain', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, 16 / 9);
    cam.left = -999; // corrupt it directly, bypassing the fit function
    applyCameraFit(cam, 16 / 9); // same aspect again — must skip recompute
    expect(cam.left).toBe(-999);
    applyCameraFit(cam, 4 / 3); // a genuinely different aspect — must recompute
    expect(cam.left).not.toBe(-999);
  });
});

describe('camera fit — perspective', () => {
  it("'none' leaves fov exactly as authored, regardless of aspect", () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    fitted(cam, { mode: 'none', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, 16 / 9);
    expect(cam.fov).toBe(50);
  });

  it("'height' leaves fov exactly as authored (vFov already IS the height framing)", () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    fitted(cam, { mode: 'height', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, 0.4);
    expect(cam.fov).toBe(50);
  });

  it("'width' derives a new fov so the horizontal FOV stays what the design implies, at the new aspect", () => {
    const designAspect = 10 / 6;
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    fitted(cam, { mode: 'width', designWidth: 10, designHeight: 6 });
    const targetHFov = 2 * Math.atan(Math.tan((50 * Math.PI) / 360) * designAspect);

    for (const aspect of [0.4, 1, designAspect, 3]) {
      const c = new PerspectiveCamera(50, 1, 0.1, 100);
      fitted(c, { mode: 'width', designWidth: 10, designHeight: 6 });
      applyCameraFit(c, aspect);
      const vFovRad = (c.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
      expect(hFov).toBeCloseTo(targetHFov, 5); // horizontal extent preserved
    }
    void cam;
  });

  it("'width' at exactly the design aspect leaves fov unchanged (self-consistent with 'height')", () => {
    const designAspect = 10 / 6;
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    fitted(cam, { mode: 'width', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, designAspect);
    expect(cam.fov).toBeCloseTo(50, 5);
  });

  it("'contain' widens fov (zooms out) on a narrower-than-design aspect, to keep the full width visible too", () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    fitted(cam, { mode: 'contain', designWidth: 10, designHeight: 6 }); // designAspect ≈ 1.67
    applyCameraFit(cam, 0.5); // portrait — much narrower than design
    expect(cam.fov).toBeGreaterThan(50);
  });

  it("'contain' leaves fov unchanged on a wider-than-design aspect (height already binds)", () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    fitted(cam, { mode: 'contain', designWidth: 10, designHeight: 6 });
    applyCameraFit(cam, 4); // much wider than design
    expect(cam.fov).toBeCloseTo(50, 5);
  });
});
