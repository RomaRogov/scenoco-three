import { Vector2 } from 'three';
import { MouseButton, type KeyCode } from './KeyCode.js';

/**
 * Keyboard, mouse and wheel state, sampled per frame. Mirrors Unity's `Input`.
 *
 * `getKey` reports whether something is held; `getKeyDown` / `getKeyUp` report the single
 * frame it changed. `Engine` calls `endFrame` after the event cycle to roll the edges over,
 * so every component sees the same input for a given frame regardless of update order.
 *
 * Keys are named by {@link KeyCode} — `KeyCode.W`, `KeyCode.Space`, `KeyCode.LeftShift` —
 * so a mistyped binding is a compile error rather than a control that silently never fires.
 */
class InputClass {
  /** Pointer position in CSS pixels, relative to the attached element. */
  readonly mousePosition = new Vector2();
  /** Pointer position in normalized device coordinates, ready for `Raycaster.setFromCamera`. */
  readonly pointer = new Vector2();
  /** Pointer movement since the previous frame, in CSS pixels. */
  readonly mouseDelta = new Vector2();
  /** Wheel movement this frame. Unity spells it the same way. */
  readonly mouseScrollDelta = new Vector2();

  private readonly held = new Set<KeyCode>();
  private readonly pressed = new Set<KeyCode>();
  private readonly released = new Set<KeyCode>();
  private readonly buttonsHeld = new Set<MouseButton>();
  private readonly buttonsPressed = new Set<MouseButton>();
  private readonly buttonsReleased = new Set<MouseButton>();

  private element: HTMLElement | null = null;
  private readonly lastMouse = new Vector2();
  private hasMouseSample = false;

  /** True while `key` is held down. */
  getKey(key: KeyCode): boolean {
    return this.held.has(key);
  }

  /** True only on the frame `key` went down. */
  getKeyDown(key: KeyCode): boolean {
    return this.pressed.has(key);
  }

  /** True only on the frame `key` came up. */
  getKeyUp(key: KeyCode): boolean {
    return this.released.has(key);
  }

  /** True while `button` is held. */
  getMouseButton(button: MouseButton = MouseButton.Left): boolean {
    return this.buttonsHeld.has(button);
  }

  /** True only on the frame `button` went down. */
  getMouseButtonDown(button: MouseButton = MouseButton.Left): boolean {
    return this.buttonsPressed.has(button);
  }

  /** True only on the frame `button` came up. */
  getMouseButtonUp(button: MouseButton = MouseButton.Left): boolean {
    return this.buttonsReleased.has(button);
  }

  /**
   * A -1..1 axis from a pair of keys, the shape movement code usually wants.
   * `getAxis(KeyCode.A, KeyCode.D)` gives strafe, `getAxis(KeyCode.S, KeyCode.W)` gives forward.
   *
   * Unity's `Input.GetAxis` takes a string naming an entry in the input manager; there is no
   * such table here, so the two keys are named directly.
   */
  getAxis(negative: KeyCode, positive: KeyCode): number {
    return (this.getKey(positive) ? 1 : 0) - (this.getKey(negative) ? 1 : 0);
  }

  /** @internal wire up DOM listeners. Called by `Engine`. */
  attach(element: HTMLElement): void {
    if (this.element) this.detach();
    this.element = element;
    element.tabIndex = element.tabIndex >= 0 ? element.tabIndex : 0;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: true });
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  /** @internal */
  detach(): void {
    const element = this.element;
    if (!element) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    element.removeEventListener('pointermove', this.onPointerMove);
    element.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    element.removeEventListener('wheel', this.onWheel);
    element.removeEventListener('contextmenu', this.onContextMenu);
    this.element = null;
    this.clear();
  }

  /** @internal roll one-frame edges over. Called by `Engine` after the event cycle. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.mouseDelta.set(0, 0);
    this.mouseScrollDelta.set(0, 0);
  }

  /** Drop all held state. Used when the window loses focus, so keys do not stick down. */
  clear(): void {
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
    this.buttonsHeld.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.mouseDelta.set(0, 0);
    this.mouseScrollDelta.set(0, 0);
    this.hasMouseSample = false;
  }

  // The DOM hands out plain strings and numbers. This class is the boundary where they become
  // KeyCode / MouseButton, and it is the only place in the engine that asserts either type.
  // An unrecognised key is stored anyway and simply never matches a KeyCode lookup.

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.code as KeyCode;
    this.held.add(key);
    this.pressed.add(key);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const key = event.code as KeyCode;
    this.held.delete(key);
    this.released.add(key);
  };

  private readonly onBlur = (): void => this.clear();

  private readonly onPointerMove = (event: PointerEvent): void => {
    const element = this.element;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (this.hasMouseSample) {
      this.mouseDelta.set(x - this.lastMouse.x, y - this.lastMouse.y);
    }
    this.hasMouseSample = true;
    this.lastMouse.set(x, y);
    this.mousePosition.set(x, y);
    this.pointer.set((x / bounds.width) * 2 - 1, -(y / bounds.height) * 2 + 1);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const button = event.button as MouseButton;
    this.buttonsHeld.add(button);
    this.buttonsPressed.add(button);
    this.element?.focus?.();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const button = event.button as MouseButton;
    this.buttonsHeld.delete(button);
    this.buttonsReleased.add(button);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    this.mouseScrollDelta.set(event.deltaX, event.deltaY);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    // Right-drag is a camera control far more often than it is a menu request.
    event.preventDefault();
  };
}

export const Input = new InputClass();
export type { InputClass };
