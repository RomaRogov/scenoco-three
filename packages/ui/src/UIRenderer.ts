import type { Camera, PerspectiveCamera, WebGLRenderer } from 'three';
import { forwardHtmlEvents } from '@pmndrs/pointer-events';
import { Component as UikitComponent, Fullscreen, reversePainterSortStable } from '@pmndrs/uikit';
import { applyRect, asUikit, centreBySize, layoutStateOf } from './rect.js';
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
  private events: { update(): void; destroy(): void } | undefined;
  private configured: WebGLRenderer | undefined;
  /** Layout failures already reported, so a bad value logs once rather than at 60Hz. */
  private readonly reported = new Set<string>();

  /** Pointer events reach the elements with the rest of the frame's input, as Unity's EventSystem does. */
  override update(): void {
    this.events?.update();
  }

  /**
   * Lays out every UI root — last in the frame, so it shows the state everything else left.
   *
   * It is arithmetic over that state, so it is as valid paused as running — which is what lets an
   * editor show a HUD without starting the game.
   */
  override layout(deltaTime: number): void {
    const renderer = Engine.current?.renderer;
    if (renderer) this.configure(renderer);

    // Activation is the one authored value nothing writes back through a setter: a component
    // calls `setActive` on the node, and only this looks at it again. All of it first, then the
    // layout: done element by element, a root — built before its children, so met first — laid
    // out before its children's changes were read, and every `setActive` showed a frame late.
    for (const element of this.elements) this.syncActivation(element);

    // A content-sized, centred element is placed by a size layout has only just computed, so a
    // pass that changed one lays out again — a few at most, as wrapped text settles.
    this.layOut(renderer, deltaTime);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const element of this.elements) moved = centreBySize(element) || moved;
      if (!moved) break;
      this.layOut(renderer, 0);
    }
  }

  /** One layout pass over every UI root. */
  private layOut(renderer: WebGLRenderer | undefined, deltaTime: number): void {
    for (const element of this.elements) {
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
        asUikit(() => element.update(deltaTime * 1000)); // uikit counts in milliseconds
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

  /** Re-lay-out an element whose active state differs from what uikit was last given. */
  private syncActivation(element: UikitComponent): void {
    const active = (element as unknown as { activeInHierarchy: boolean }).activeInHierarchy;
    if (layoutStateOf(element).applied === active) return;
    applyRect(element);
  }

  private configure(renderer: WebGLRenderer): void {
    if (this.configured === renderer) return;
    this.configured = renderer;
    this.events?.destroy();

    renderer.localClippingEnabled = true;
    renderer.setTransparentSort(reversePainterSortStable);
    const canvas = renderer.domElement;
    const forwarded = forwardHtmlEvents(
      canvas,
      // pointer-events wants a perspective or orthographic camera; a scene's main camera is one
      // in practice, and its declared type is only wider.
      () => this.scene.mainCamera as PerspectiveCamera,
      this.scene,
    );
    // pointer-events decides what is under the pointer on a move, and a press goes to that. Under
    // a still mouse the game moves on — the button it clicked hides, another appears in its
    // place — and a press there went to whatever was under it last, hidden or not. A move at the
    // point of every press, delivered ahead of it, has the press aimed at what is there now.
    const aim = (event: PointerEvent): void => void canvas.dispatchEvent(new PointerEvent('pointermove', event));
    canvas.addEventListener('pointerdown', aim, { capture: true });
    this.events = {
      update: () => forwarded.update(),
      destroy: () => {
        canvas.removeEventListener('pointerdown', aim, { capture: true });
        forwarded.destroy();
      },
    };
  }

  private report(message: string): void {
    if (this.reported.has(message)) return;
    this.reported.add(message);
    console.error(`[scenoco] ui: ${message}`);
  }
}
