import { Vector2 } from 'three';
import { MouseButton, type KeyCode } from './KeyCode.js';
import { AXES, BUTTON_NAMES, MOUSE_SENSITIVITY, STICK_DEAD_ZONE, type AxisName, type AxisBinding, type ButtonName as BuiltInButton } from './axes.js';

/** Unity's built-in buttons, or any name a page element gives itself with `data-button="…"`. */
export type ButtonName = BuiltInButton | (string & {});

/**
 * Keyboard, mouse, wheel and gamepad state, sampled per frame. Mirrors Unity's `Input`.
 *
 * Gamepads are read once a frame, as the browser only lets them be: their buttons are keys
 * (`KeyCode.JoystickButton0`…), their sticks feed the named axes beside the keys, and every pad
 * counts — whichever pushes further.
 *
 * Edges (`getKeyDown`/`getKeyUp`) roll over in `endFrame`, so every component sees the same
 * input for a frame regardless of update order.
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

  private readonly smoothed = new Map<AxisName, number>();
  private readonly overrides = new Map<AxisName, number>();
  private readonly buttonOverrides = new Map<ButtonName, boolean>();
  private readonly buttonsDownNamed = new Set<ButtonName>();
  private readonly buttonsUpNamed = new Set<ButtonName>();
  private readonly buttonsWereDown = new Set<ButtonName>();
  /** Page elements with `data-button` held down now, by the pointer holding each. */
  private readonly pagePointers = new Map<number, string>();
  /** Every name a `data-button` has had, so its edges are worked out each frame. */
  private readonly pageNames = new Set<string>();
  /** Pressed since the last frame — so a tap shorter than a frame still goes down for one. */
  private readonly pagePressed = new Set<string>();

  /** The connected gamepads' names, and their sticks' axes past the dead zone, the largest of any pad's. */
  private pads: string[] = [];
  private readonly sticks: number[] = [];
  /** The gamepad buttons held, as the keys they count as. */
  private readonly padHeld = new Set<KeyCode>();

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
   * A named axis, -1..1, eased toward the key's target — Unity's `Input.GetAxis`.
   *
   * The mouse axes report this frame's movement instead, and an axis under {@link setAxis}
   * answers with that value unsmoothed.
   */
  getAxis(axis: AxisName): number {
    const override = this.overrides.get(axis);
    if (override !== undefined) return override;
    if (axis === 'Mouse X') return this.mouseDelta.x * MOUSE_SENSITIVITY;
    if (axis === 'Mouse Y') return this.mouseDelta.y * MOUSE_SENSITIVITY;
    if (axis === 'Mouse ScrollWheel') return this.mouseScrollDelta.y * MOUSE_SENSITIVITY;
    return further(this.smoothed.get(axis) ?? 0, this.stickAxis(axis));
  }

  /** The same axis without the easing: -1, 0 or 1 for a key, a stick's own value — Unity's `GetAxisRaw`. */
  getAxisRaw(axis: AxisName): number {
    const override = this.overrides.get(axis);
    if (override !== undefined) return override;
    if (axis === 'Mouse X' || axis === 'Mouse Y' || axis === 'Mouse ScrollWheel') {
      return this.getAxis(axis);
    }
    return further(this.rawAxis(axis), this.stickAxis(axis));
  }

  /** The connected gamepads' names — Unity's `GetJoystickNames`. Empty with none, or before one has been touched: the browser shows a pad only once a button is pressed on it. */
  getJoystickNames(): string[] {
    return [...this.pads];
  }

  /** True while a named button is held — Unity's `GetButton`. `getButton('Jump')`. */
  getButton(button: ButtonName): boolean {
    const override = this.buttonOverrides.get(button);
    if (override !== undefined) return override;
    for (const name of this.pagePointers.values()) if (name === button) return true;
    return this.rawAxis(button as AxisName) > 0;
  }

  /** True only on the frame it went down — Unity's `GetButtonDown`. */
  getButtonDown(button: ButtonName): boolean {
    return this.buttonsDownNamed.has(button);
  }

  /** True only on the frame it came up — Unity's `GetButtonUp`. */
  getButtonUp(button: ButtonName): boolean {
    return this.buttonsUpNamed.has(button);
  }

  /**
   * Drive an axis from somewhere other than the keyboard — a virtual joystick, a gamepad, a replay.
   *
   * It holds until released with `null`, and the keys for that axis are ignored while it is set.
   */
  setAxis(axis: AxisName, value: number | null): void {
    if (value === null) this.overrides.delete(axis);
    else this.overrides.set(axis, value);
  }

  /** Drive a named button the same way. `getButtonDown` still fires once per press. */
  setButton(button: ButtonName, down: boolean | null): void {
    if (down === null) this.buttonOverrides.delete(button);
    else this.buttonOverrides.set(button, down);
  }

  /** Which axes and buttons are currently being driven from outside. */
  get overriddenAxes(): AxisName[] {
    return [...this.overrides.keys()];
  }

  /** A key or mouse button bound to this button went down since the last frame. */
  private pressedSinceFrame(name: ButtonName): boolean {
    const binding: AxisBinding | undefined = AXES[name as keyof typeof AXES];
    if (!binding) return false;
    return (binding.positive ?? []).some((key) => this.pressed.has(key)) || (binding.mouse !== undefined && this.buttonsPressed.has(binding.mouse));
  }

  /** A named axis's gamepad stick, past the dead zone: 0 where it has none. */
  private stickAxis(axis: AxisName): number {
    const stick = (AXES[axis as keyof typeof AXES] as AxisBinding | undefined)?.stick;
    if (!stick) return 0;
    const value = this.sticks[stick.axis] ?? 0;
    return stick.invert ? -value : value;
  }

  /**
   * Read the gamepads, as the browser has them only when asked. A button going down or up is a key
   * going down or up this frame; each stick axis is the furthest any pad pushes it, past the dead
   * zone and stretched so it still reaches 1.
   */
  private pollGamepads(): void {
    const pads =
      typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
        ? [...navigator.getGamepads()].filter((pad): pad is Gamepad => !!pad && pad.connected)
        : [];
    this.pads = pads.map((pad) => pad.id);
    this.sticks.length = 0;
    const down = new Set<KeyCode>();
    for (const pad of pads) {
      pad.buttons.forEach((button, i) => void (i < 20 && button.pressed && down.add(`JoystickButton${i}` as KeyCode)));
      pad.axes.forEach((value, i) => {
        const past = Math.max(0, Math.abs(value) - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
        this.sticks[i] = further(this.sticks[i] ?? 0, Math.sign(value) * Math.min(1, past));
      });
    }
    for (const code of [...this.padHeld]) {
      if (down.has(code)) continue;
      this.padHeld.delete(code);
      this.held.delete(code);
      this.released.add(code);
    }
    for (const code of down) {
      if (this.padHeld.has(code)) continue;
      this.padHeld.add(code);
      this.held.add(code);
      this.pressed.add(code);
    }
  }

  /** The instantaneous -1/0/1 of a keyboard entry, before smoothing and before any override. */
  private rawAxis(axis: AxisName): number {
    // Through the interface rather than the literal: the entries differ in which keys they
    // carry, and a union of those shapes has no `.negative` to read.
    const binding: AxisBinding | undefined = AXES[axis as keyof typeof AXES];
    if (!binding) return 0;
    const positive =
      (binding.positive ?? []).some((key) => this.held.has(key)) ||
      (binding.mouse !== undefined && this.buttonsHeld.has(binding.mouse));
    const negative = (binding.negative ?? []).some((key) => this.held.has(key));
    return (positive ? 1 : 0) - (negative ? 1 : 0);
  }

  /**
   * Move the smoothed axes one frame and work out this frame's button edges. Unscaled time: a
   * game frozen at `timeScale = 0` still has to notice the key that unfreezes it.
   *
   * @internal
   */
  advance(deltaTime: number): void {
    this.pollGamepads();
    for (const [name, binding] of Object.entries(AXES) as Array<[AxisName, AxisBinding]>) {
      const target = this.rawAxis(name);
      const current = this.smoothed.get(name) ?? 0;
      // Unity's `snap`: pushing the other way starts from the middle rather than skidding
      // through it.
      const from = target !== 0 && Math.sign(target) !== Math.sign(current) ? 0 : current;
      const rate = (target === 0 ? binding.gravity : binding.sensitivity) * deltaTime;
      const next =
        target === from ? target : from + Math.sign(target - from) * Math.min(rate, Math.abs(target - from));
      this.smoothed.set(name, next);
    }

    this.buttonsDownNamed.clear();
    this.buttonsUpNamed.clear();
    for (const name of [...BUTTON_NAMES, ...this.pageNames]) {
      // Pressed since the last frame counts too: a tap shorter than a frame still goes down once.
      const down = this.getButton(name) || this.pagePressed.has(name) || this.pressedSinceFrame(name);
      const was = this.buttonsWereDown.has(name);
      if (down && !was) this.buttonsDownNamed.add(name);
      if (!down && was) this.buttonsUpNamed.add(name);
      if (down) this.buttonsWereDown.add(name);
      else this.buttonsWereDown.delete(name);
    }
    this.pagePressed.clear();
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
    // A cancelled pointer is a released one. The browser cancels a touch it takes over, and a
    // button that never heard the release stayed held until the next tap.
    window.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: true });
    element.addEventListener('contextmenu', this.onContextMenu);
    // A HUD button is an element of the page: `<button data-button="Pause">`. Its press is a
    // virtual button, sampled per frame like a key — not a handler firing between frames.
    document.addEventListener('pointerdown', this.onPagePointerDown, true);
    document.addEventListener('click', this.onPageClick, true);
  }

  /** @internal `from`: only if still attached to it — a game disposed after the next one started leaves that one's. */
  detach(from?: HTMLElement): void {
    const element = this.element;
    if (!element || (from && from !== element)) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    element.removeEventListener('pointermove', this.onPointerMove);
    element.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    element.removeEventListener('wheel', this.onWheel);
    element.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerdown', this.onPagePointerDown, true);
    document.removeEventListener('click', this.onPageClick, true);
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
    // Overrides go too: a virtual stick left pushed through a scene reload is a character that
    // walks into a wall on its own.
    this.smoothed.clear();
    this.overrides.clear();
    this.buttonOverrides.clear();
    this.buttonsDownNamed.clear();
    this.buttonsUpNamed.clear();
    this.buttonsWereDown.clear();
    this.pagePointers.clear();
    // A pad still held is read again, and pressed again, at the next frame.
    this.padHeld.clear();
    this.sticks.length = 0;
  }

  // The boundary where the DOM's strings and numbers become KeyCode / MouseButton, and the only
  // place that asserts either type. An unrecognised key is stored and never matches a lookup.

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) this.key(event.code as KeyCode, true);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => this.key(event.code as KeyCode, false);

  /** @internal a key going down or up, as the keyboard's events say it — or a simulation does. */
  key(key: KeyCode, down: boolean): void {
    if (down) {
      this.held.add(key);
      this.pressed.add(key);
    } else {
      this.held.delete(key);
      this.released.add(key);
    }
  }

  private readonly onBlur = (): void => this.clear();

  private readonly onPointerMove = (event: PointerEvent): void => {
    const element = this.element;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const [x, y] = local(element, bounds, event);
    if (this.hasMouseSample) {
      this.mouseDelta.set(x - this.lastMouse.x, y - this.lastMouse.y);
    }
    this.hasMouseSample = true;
    this.lastMouse.set(x, y);
    this.mousePosition.set(x, y);
    this.pointer.set((x / element.clientWidth) * 2 - 1, -(y / element.clientHeight) * 2 + 1);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const button = event.button as MouseButton;
    this.buttonsHeld.add(button);
    this.buttonsPressed.add(button);
    // A drag's movement counts from its press: a finger has no hover, so its first move would
    // otherwise read as a jump from wherever the previous touch lifted.
    const bounds = this.element?.getBoundingClientRect();
    if (bounds) {
      const [x, y] = local(this.element!, bounds, event);
      this.lastMouse.set(x, y);
      this.mousePosition.set(x, y);
      this.pointer.set((x / this.element!.clientWidth) * 2 - 1, -(y / this.element!.clientHeight) * 2 + 1);
      this.hasMouseSample = true;
      this.mouseDelta.set(0, 0);
    }
    this.element?.focus?.();
  };

  private readonly onPagePointerDown = (event: PointerEvent): void => {
    const name = (event.target as Element | null)?.closest?.('[data-button]')?.getAttribute('data-button');
    if (!name) return;
    this.pageNames.add(name);
    this.pagePressed.add(name);
    this.pagePointers.set(event.pointerId, name);
  };

  /**
   * A click no pointer made — Enter or Space on a focused button, or a script's `button.click()` —
   * presses it for one frame. A pointer's own click was already its press.
   */
  private readonly onPageClick = (event: MouseEvent): void => {
    if (event.detail !== 0) return;
    const name = (event.target as Element | null)?.closest?.('[data-button]')?.getAttribute('data-button');
    if (!name) return;
    this.pageNames.add(name);
    this.pagePressed.add(name);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.pagePointers.delete(event.pointerId);
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

/** Where an event is on the element, in its own CSS pixels — the same numbers when a transform scales the page. */
function local(element: HTMLElement, bounds: DOMRect, event: PointerEvent): [number, number] {
  const sx = element.clientWidth / (bounds.width || 1);
  const sy = element.clientHeight / (bounds.height || 1);
  return [(event.clientX - bounds.left) * sx, (event.clientY - bounds.top) * sy];
}

/** Whichever of two inputs is pushed further: the keys or a stick, one pad or another. */
function further(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}
