import { Vector2 } from 'three';
import { MouseButton, type KeyCode } from './KeyCode.js';
import { AXES, BUTTON_NAMES, MOUSE_SENSITIVITY, type Axis, type AxisBinding, type Button } from './axes.js';

/**
 * Keyboard, mouse and wheel state, sampled per frame. Mirrors Unity's `Input`.
 *
 * `getKey` reports whether something is held; `getKeyDown` / `getKeyUp` report the single
 * frame it changed. `Engine` calls `endFrame` after the event cycle to roll the edges over,
 * so every component sees the same input for a given frame regardless of update order.
 *
 * Keys are named by {@link KeyCode} — `KeyCode.W`, `KeyCode.Space`, `KeyCode.LeftShift` —
 * so a mistyped binding is a type error rather than a control that silently never fires.
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

  private readonly smoothed = new Map<Axis, number>();
  private readonly overrides = new Map<Axis, number>();
  private readonly buttonOverrides = new Map<Button, boolean>();
  private readonly buttonsDownNamed = new Set<Button>();
  private readonly buttonsUpNamed = new Set<Button>();
  private readonly buttonsWereDown = new Set<Button>();

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
   * A named axis, -1..1, smoothed — Unity's `Input.GetAxis`.
   *
   * `getAxis('Horizontal')` is A/D and the left/right arrows; `getAxis('Vertical')` is W/S and
   * up/down. The value eases toward the key's target and falls back to 0 when nothing is held,
   * at Unity's default rates, which is why a character built on it accelerates instead of
   * snapping. {@link getAxisRaw} is the same axis without the easing.
   *
   * `Mouse X`, `Mouse Y` and `Mouse ScrollWheel` report this frame's movement rather than a held
   * key, scaled the way Unity scales them.
   *
   * An axis set with {@link setAxis} answers with that value instead, unsmoothed — the point of
   * an override is that something else is already deciding the number.
   */
  getAxis(axis: Axis): number {
    const override = this.overrides.get(axis);
    if (override !== undefined) return override;
    if (axis === 'Mouse X') return this.mouseDelta.x * MOUSE_SENSITIVITY;
    if (axis === 'Mouse Y') return this.mouseDelta.y * MOUSE_SENSITIVITY;
    if (axis === 'Mouse ScrollWheel') return this.mouseScrollDelta.y * MOUSE_SENSITIVITY;
    return this.smoothed.get(axis) ?? 0;
  }

  /**
   * The same axis without the easing: -1, 0 or 1 for a keyboard entry — Unity's `GetAxisRaw`.
   *
   * What movement code that does its own acceleration wants, and what a test wants, since it
   * reaches its value on the first frame rather than the tenth.
   */
  getAxisRaw(axis: Axis): number {
    const override = this.overrides.get(axis);
    if (override !== undefined) return override;
    if (axis === 'Mouse X' || axis === 'Mouse Y' || axis === 'Mouse ScrollWheel') {
      return this.getAxis(axis);
    }
    return this.rawAxis(axis);
  }

  /** True while a named button is held — Unity's `GetButton`. `getButton('Jump')`. */
  getButton(button: Button): boolean {
    const override = this.buttonOverrides.get(button);
    if (override !== undefined) return override;
    return this.rawAxis(button) > 0;
  }

  /** True only on the frame it went down — Unity's `GetButtonDown`. */
  getButtonDown(button: Button): boolean {
    return this.buttonsDownNamed.has(button);
  }

  /** True only on the frame it came up — Unity's `GetButtonUp`. */
  getButtonUp(button: Button): boolean {
    return this.buttonsUpNamed.has(button);
  }

  /**
   * Drive an axis from somewhere other than the keyboard — a virtual joystick, a gamepad, a
   * replay. `setAxis('Horizontal', 0.5)` and every component reading that axis sees 0.5.
   *
   * It holds until it is changed or released with `null`, because that is what a stick does: it
   * stays where a thumb leaves it. While an override is set the keys for that axis are ignored,
   * so an on-screen control and the keyboard cannot fight over one value.
   */
  setAxis(axis: Axis, value: number | null): void {
    if (value === null) this.overrides.delete(axis);
    else this.overrides.set(axis, value);
  }

  /**
   * Drive a named button the same way — an on-screen Jump, or a test.
   *
   * The one-frame edges `getButtonDown` and `getButtonUp` report are derived from the change, so
   * a button held down for three frames still fires `getButtonDown` exactly once.
   */
  setButton(button: Button, down: boolean | null): void {
    if (down === null) this.buttonOverrides.delete(button);
    else this.buttonOverrides.set(button, down);
  }

  /** Which axes and buttons are currently being driven from outside. */
  get overriddenAxes(): Axis[] {
    return [...this.overrides.keys()];
  }

  /** The instantaneous -1/0/1 of a keyboard entry, before smoothing and before any override. */
  private rawAxis(axis: Axis): number {
    // Typed through the interface rather than the literal: the entries differ in which keys they
    // carry, and a union of those shapes is not something to read a `.negative` off.
    const binding: AxisBinding | undefined = AXES[axis as keyof typeof AXES];
    if (!binding) return 0;
    const positive =
      (binding.positive ?? []).some((key) => this.held.has(key)) ||
      (binding.mouse !== undefined && this.buttonsHeld.has(binding.mouse));
    const negative = (binding.negative ?? []).some((key) => this.held.has(key));
    return (positive ? 1 : 0) - (negative ? 1 : 0);
  }

  /**
   * Move the smoothed axes one frame, and work out this frame's button edges.
   *
   * Called from `SceneManager.tick` before any component runs, so `update` reads a value that
   * belongs to the frame it is in. Unscaled time on purpose: a game frozen with `timeScale = 0`
   * still has to notice the key that unfreezes it.
   *
   * @internal
   */
  advance(deltaTime: number): void {
    for (const [name, binding] of Object.entries(AXES) as Array<[Axis, AxisBinding]>) {
      const target = this.rawAxis(name);
      const current = this.smoothed.get(name) ?? 0;
      // Unity's `snap`: pushing the other way starts from the middle rather than skidding
      // through it, so a direction change is immediate even though the ramp is not.
      const from = target !== 0 && Math.sign(target) !== Math.sign(current) ? 0 : current;
      const rate = (target === 0 ? binding.gravity : binding.sensitivity) * deltaTime;
      const next =
        target === from ? target : from + Math.sign(target - from) * Math.min(rate, Math.abs(target - from));
      this.smoothed.set(name, next);
    }

    this.buttonsDownNamed.clear();
    this.buttonsUpNamed.clear();
    for (const name of BUTTON_NAMES) {
      const down = this.getButton(name);
      const was = this.buttonsWereDown.has(name);
      if (down && !was) this.buttonsDownNamed.add(name);
      if (!down && was) this.buttonsUpNamed.add(name);
      if (down) this.buttonsWereDown.add(name);
      else this.buttonsWereDown.delete(name);
    }
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
    // Overrides go too: `clear` is "forget everything the player was doing", and a virtual stick
    // left pushed through a scene reload is a character that walks into a wall on its own.
    this.smoothed.clear();
    this.overrides.clear();
    this.buttonOverrides.clear();
    this.buttonsDownNamed.clear();
    this.buttonsUpNamed.clear();
    this.buttonsWereDown.clear();
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
