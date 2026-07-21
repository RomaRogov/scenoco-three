import { PerspectiveCamera, type Camera } from 'three';
import { forwardHtmlEvents } from '@pmndrs/pointer-events';
import { System, system, type Component as SceneComponent } from '@scenoco-three/core';
import { UiKitComponent, Fullscreen, reversePainterSortStable } from './uikit.js';

/**
 * Drives every uikit element in the scene. Auto-runs whenever the scene contains
 * a UI element (the node-query System seam), in the editor too — layout must be
 * visible while editing, not just in play mode.
 *
 * Per uikit's contract it does three things:
 *  - applies the required renderer settings once (`localClippingEnabled`,
 *    `setTransparentSort(reversePainterSortStable)`) and forwards the canvas's
 *    pointer events into the scene (`@pmndrs/pointer-events`), which powers
 *    uikit hover/active states, scrolling, and W3C events on elements
 *    (`element.addEventListener('click', …)`),
 *  - injects the engine's renderer into `Fullscreen` roots (their constructor
 *    wants it, but node factories are pure — see FullscreenNode.build),
 *  - calls `update(delta)` once per frame on each UI **root** — a uikit element
 *    whose parent is not itself a uikit element; nested elements are laid out by
 *    their root.
 *
 * Pointer blocking is uikit-native: an element with `pointerEvents="auto"` (the
 * default) intersects pointer rays, so a HUD panel over the game swallows the
 * click for `engine.raycast`/component pointer hooks too — Unity's "UI blocks
 * scene clicks". Author `pointerEvents="none"` for click-through chrome.
 * SceNoCo's own component hooks (`onPointerDown`/`onPointerClick`) work on UI
 * nodes like on any mesh, so a button is a UI node plus a component.
 */
@system({ nodes: UiKitComponent, executeInEditor: true })
export class UIRenderSystem extends System<SceneComponent, UiKitComponent> {
  private warnedFullscreen = false;
  /** Error messages already reported, so a per-frame failure logs once, not at 60Hz. */
  private readonly warned = new Set<string>();
  private htmlEvents?: { update: () => void; destroy: () => void };
  /** Stand-in for `getCamera` while the scene has no camera yet (never renders). */
  private readonly fallbackCamera = new PerspectiveCamera();

  override onAttach(): void {
    const renderer = this.engine.renderer;
    if (!renderer) return; // headless engine — layout still runs, nothing renders
    renderer.localClippingEnabled = true;
    renderer.setTransparentSort(reversePainterSortStable);
    this.htmlEvents = forwardHtmlEvents(
      renderer.domElement,
      // pointer-events wants a Perspective/Orthographic camera; the engine's
      // mainCamera in practice is one (its Camera typing is just wider).
      () => (this.engine.mainCamera ?? this.fallbackCamera) as PerspectiveCamera,
      this.engine.scene,
    );
  }

  override onDetach(): void {
    this.htmlEvents?.destroy();
    this.htmlEvents = undefined;
  }

  override step(dt: number): void {
    this.htmlEvents?.update();
    const renderer = this.engine.renderer;
    for (const element of this.nodes) {
      if (element.parent instanceof UiKitComponent) continue; // not a root
      if (element instanceof Fullscreen) {
        // Fullscreen sizes itself from the renderer viewport and its parent
        // camera — skip (with one loud hint) when either is missing.
        if (!renderer) continue;
        if (!(element.parent as Partial<Camera> | null)?.isCamera) {
          if (!this.warnedFullscreen) {
            this.warnedFullscreen = true;
            console.warn('scenoco-ui: <Fullscreen> must be a child of the camera node — skipping its layout');
          }
          continue;
        }
        // `renderer` is a plain field uikit only reads in update(); it is
        // `protected` in the typings, hence the cast.
        const host = element as unknown as { renderer?: typeof renderer };
        if (host.renderer !== renderer) host.renderer = renderer;
      }
      // Contain layout errors per root: a bad authored value (uikit validates
      // properties at layout time) must break that UI root's frame, not the
      // engine's whole tick loop.
      try {
        element.update(dt * 1000); // uikit updates in milliseconds
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!this.warned.has(message)) {
          this.warned.add(message);
          console.error(`scenoco-ui: UI root update failed — ${message}`);
        }
      }
    }
  }
}
