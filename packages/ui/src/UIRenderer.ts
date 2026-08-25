import type { Camera, PerspectiveCamera, WebGLRenderer } from 'three';
import { forwardHtmlEvents } from '@pmndrs/pointer-events';
import { Component as UikitComponent, Fullscreen, reversePainterSortStable } from '@pmndrs/uikit';
import { applyRect } from './rect.js';
import { Engine, System } from '@scenoco-three/core';

/**
 * Lays out and draws every UI element in the scene.
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <UIRenderer />
 *   </Systems>
 * </Scene>
 * ```
 *
 * Declaring it is optional — the first `<Canvas>` or `<Panel>` calls `requireSystem` and gets
 * one. It is a system because uikit lays out from a **root** once per frame, and a root belongs
 * to no particular node: the same line core draws for a physics world or a batched renderer.
 *
 * It does three things uikit's contract asks for: sets the renderer flags UI needs
 * (`localClippingEnabled`, a back-to-front transparent sort), forwards the canvas's pointer
 * events into the scene so hover, press and scrolling work, and calls `update` on each root.
 *
 * Headless it lays out and draws nothing, which is deliberate: layout is pure arithmetic, so a
 * test can assert what a document produced without a GPU.
 */
export class UIRenderer extends System {
  /** Every element that asked to be drawn, root or not. */
  private readonly elements = new Set<UikitComponent>();
  /** The active state each element was last laid out with, so a change is noticed once. */
  private readonly shown = new WeakMap<UikitComponent, boolean>();
  private events: { update(): void; destroy(): void } | undefined;
  private configured: WebGLRenderer | undefined;
  /** Layout failures already reported, so a bad value logs once rather than at 60Hz. */
  private readonly reported = new Set<string>();

  /**
   * A UI layout is arithmetic over the current state, so it is as valid paused as running —
   * which is what lets an editor show a HUD without starting the game.
   */
  override layout(deltaTime: number): void {
    this.update(deltaTime);
  }

  override update(deltaTime: number): void {
    const renderer = Engine.current?.renderer;
    if (renderer) this.configure(renderer);
    this.events?.update();

    for (const element of this.elements) {
      // Activation is the one authored value nothing writes back through a setter: a component
      // calls `setActive` on the node, and only this loop ever looks at it again.
      this.syncActivation(element);
      // uikit lays a whole tree out from its root, so only roots are updated; a nested element
      // asked to join anyway, which is what keeps the document from having to say which is which.
      if (element.parent instanceof UikitComponent) continue;
      if (element instanceof Fullscreen) {
        if (!renderer) continue; // it sizes itself from the viewport; there is none
        if (!(element.parent as Partial<Camera> | null)?.isCamera) {
          this.report('<Canvas> must be a child of the camera node — skipping its layout');
          continue;
        }
        // `renderer` is a plain field uikit only reads in `update`, and the constructor had none
        // to take: a document builds a Canvas long before the engine exists.
        const host = element as unknown as { renderer?: WebGLRenderer };
        if (host.renderer !== renderer) host.renderer = renderer;
      }
      try {
        element.update(deltaTime * 1000); // uikit counts in milliseconds
      } catch (error) {
        // One bad authored value must cost that UI root its frame, not the whole engine tick.
        this.report(error instanceof Error ? error.message : String(error));
      }
    }
  }

  override onDestroy(): void {
    this.events?.destroy();
    this.events = undefined;
    this.elements.clear();
    this.configured = undefined;
  }

  /** @internal called by every element as it enters the scene. */
  add(element: UikitComponent): void {
    this.elements.add(element);
    element.addEventListener('removed', () => {
      // Only when it left for good: being re-parented under another UI element keeps it live,
      // and the root check in `update` already ignores it.
      if (!element.parent) this.elements.delete(element);
    });
  }

  /** The renderer settings uikit needs, and the pointer bridge — once per renderer. */
  /** Re-lay-out an element whose `setActive` state changed, so `display` follows it. */
  private syncActivation(element: UikitComponent): void {
    const active = (element as unknown as { activeInHierarchy: boolean }).activeInHierarchy;
    if (this.shown.get(element) === active) return;
    this.shown.set(element, active);
    applyRect(element);
  }

  private configure(renderer: WebGLRenderer): void {
    if (this.configured === renderer) return;
    this.configured = renderer;
    this.events?.destroy();

    renderer.localClippingEnabled = true;
    renderer.setTransparentSort(reversePainterSortStable);
    this.events = forwardHtmlEvents(
      renderer.domElement,
      // pointer-events wants a perspective or orthographic camera; a scene's main camera is one
      // in practice, and its declared type is only wider.
      () => this.scene.mainCamera as PerspectiveCamera,
      this.scene,
    );
  }

  private report(message: string): void {
    if (this.reported.has(message)) return;
    this.reported.add(message);
    console.error(`[scenoco] ui: ${message}`);
  }
}
