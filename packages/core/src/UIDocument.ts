import { Vector2 } from 'three';
import { Behaviour } from './kernel/Behaviour.js';
import { Screen } from './Screen.js';

/**
 * Unity's `UIDocument`, with its panel's Scale With Screen Size: the page element `element` is the
 * game's UI, laid out at `referenceResolution` and scaled to the screen — matching its width at
 * `match` 0, its height at 1, in between as Unity blends them. So a length in the page's CSS is a
 * reference pixel, as it is in USS, and the UI keeps its proportions on a phone and a monitor alike.
 *
 * The root lets the pointer through to the game, as a root with `picking-mode="Ignore"` does: a
 * control in it says `pointer-events: auto`.
 */
export class UIDocument extends Behaviour {
  /** The id of the UI's root element in the page. */
  element = 'ui';
  /** The size the UI is designed at, in CSS pixels. */
  referenceResolution = new Vector2(1280, 720);
  /** 0 matches the screen's width, 1 its height. */
  match = 0.5;

  private root: HTMLElement | null = null;
  private applied = '';

  /** The UI's root element — Unity's `rootVisualElement`. */
  get rootVisualElement(): HTMLElement {
    if (this.root) return this.root;
    const found = document.getElementById(this.element);
    if (!found) throw new Error(`UIDocument: the page has no element id="${this.element}". Put the UI in one: <div id="${this.element}">…</div>.`);
    return (this.root = found);
  }

  /** How many screen pixels one reference pixel is now: Unity's scale for Scale With Screen Size. */
  get scale(): number {
    const width = Math.log2(Screen.width / this.referenceResolution.x);
    const height = Math.log2(Screen.height / this.referenceResolution.y);
    return 2 ** (width + (height - width) * this.match);
  }

  override awake(): void {
    this.fit();
  }

  override lateUpdate(): void {
    this.fit();
  }

  /** The root at the screen's size in reference pixels, scaled up to cover it — again only when either changed. */
  private fit(): void {
    const scale = this.scale;
    const key = `${Screen.width}x${Screen.height}@${scale}`;
    if (key === this.applied) return;
    this.applied = key;
    Object.assign(this.rootVisualElement.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${Screen.width / scale}px`,
      height: `${Screen.height / scale}px`,
      transformOrigin: '0 0',
      scale: String(scale),
      pointerEvents: 'none',
    });
  }
}
