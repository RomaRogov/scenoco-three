import { Vector2 } from 'three';

/**
 * Unity-style input, owned by the Engine and reached from any component via
 * `this.engine.input`. Exposes keyboard, mouse, and gamepad with per-frame edge
 * detection (`getKeyDown`/`getKeyUp` are true for exactly one frame).
 *
 * Frame model: DOM handlers only mutate the "held" state and accumulate pending
 * down/up sets; the Engine calls `beginFrame()` at the top of each `tick()`,
 * which commits those into the frame snapshot, samples the mouse, and polls the
 * gamepads. Queries are therefore stable across fixedUpdate/update/lateUpdate.
 *
 * Headless-safe: with no DOM (`window` undefined) it attaches no listeners and
 * every getter returns a neutral value, so the engine runs in tests/SSR.
 */
export class InputManager {
  // ── keyboard ───────────────────────────────────────────────────────────────
  private readonly held = new Set<string>();
  private pendingDown = new Set<string>();
  private pendingUp = new Set<string>();
  private downThisFrame = new Set<string>();
  private upThisFrame = new Set<string>();

  // ── mouse ──────────────────────────────────────────────────────────────────
  private readonly mouseHeld = [false, false, false];
  private pendingMouseDown = [false, false, false];
  private pendingMouseUp = [false, false, false];
  private mouseDownThisFrame = [false, false, false];
  private mouseUpThisFrame = [false, false, false];
  /** Latest raw client coords (top-left origin) from the most recent move. */
  private clientX = 0;
  private clientY = 0;
  private readonly _mousePosition = new Vector2();
  private readonly _mouseNdc = new Vector2();
  private readonly _mouseDelta = new Vector2();
  private readonly _mouseScroll = new Vector2();
  private pendingMove = new Vector2();
  private pendingScroll = new Vector2();
  private mouseSeen = false;

  // ── gamepad ────────────────────────────────────────────────────────────────
  /** Per-pad: button-pressed state from the previous and current polls. */
  private gamepadPrev = new Map<number, boolean[]>();
  private gamepadCur = new Map<number, boolean[]>();
  /** Synthetic pads injected by tooling/tests; when set, used instead of the navigator. */
  private syntheticPads?: Map<number, Gamepad>;

  /** Pointer position injected by tooling/tests (canvas-relative px), bypassing the DOM. */
  private injectedPos?: { x: number; y: number };

  private readonly canvas?: HTMLCanvasElement;
  private readonly target?: EventTarget;
  private detach: Array<() => void> = [];

  constructor(opts: { canvas?: HTMLCanvasElement; target?: EventTarget } = {}) {
    this.canvas = opts.canvas;
    // Keyboard/wheel/gamepad live on the window; mouse move/buttons on the canvas
    // (so positions are canvas-relative). Default the target to the global object.
    this.target = opts.target ?? (typeof window !== 'undefined' ? window : undefined);
    this.attach();
  }

  // ── keyboard API ─────────────────────────────────────────────────────────────

  /** True while the key is held. */
  getKey(key: KeyCode): boolean {
    return this.held.has(key);
  }
  /** True only on the frame the key went down. */
  getKeyDown(key: KeyCode): boolean {
    return this.downThisFrame.has(key);
  }
  /** True only on the frame the key was released. */
  getKeyUp(key: KeyCode): boolean {
    return this.upThisFrame.has(key);
  }
  /** True while any key is held (Unity `Input.anyKey`). */
  get anyKey(): boolean {
    return this.held.size > 0;
  }

  // ── mouse API ────────────────────────────────────────────────────────────────

  /** Canvas-relative pixels, bottom-left origin (y up) — Unity screen space. */
  get mousePosition(): Vector2 {
    return this._mousePosition;
  }
  /** Normalized device coords [-1..1] (x right, y up) — feed straight to a Raycaster. */
  get mouseNdc(): Vector2 {
    return this._mouseNdc;
  }
  /** Raw pointer movement this frame (x right, y down) — for FPS/editor look. */
  get mouseDelta(): Vector2 {
    return this._mouseDelta;
  }
  /** Wheel delta accumulated this frame. */
  get mouseScrollDelta(): Vector2 {
    return this._mouseScroll;
  }
  /** Button held — Unity convention: 0 left, 1 right, 2 middle. */
  getMouseButton(button: 0 | 1 | 2): boolean {
    return this.mouseHeld[button] ?? false;
  }
  getMouseButtonDown(button: 0 | 1 | 2): boolean {
    return this.mouseDownThisFrame[button] ?? false;
  }
  getMouseButtonUp(button: 0 | 1 | 2): boolean {
    return this.mouseUpThisFrame[button] ?? false;
  }

  // ── virtual axes (Unity parity) ──────────────────────────────────────────────

  /** Range [-1..1] from arrows/WASD plus the gamepad left stick. */
  getAxis(axis: 'Horizontal' | 'Vertical'): number {
    const pad = this.getGamepad(0);
    if (axis === 'Horizontal') {
      const keys = (this.getKey('D') || this.getKey('RightArrow') ? 1 : 0) - (this.getKey('A') || this.getKey('LeftArrow') ? 1 : 0);
      return clampAxis(keys + (pad?.leftStick.x ?? 0));
    }
    const keys = (this.getKey('W') || this.getKey('UpArrow') ? 1 : 0) - (this.getKey('S') || this.getKey('DownArrow') ? 1 : 0);
    return clampAxis(keys + (pad?.leftStick.y ?? 0));
  }

  // ── gamepad API ──────────────────────────────────────────────────────────────

  /** Live state of the connected gamepad at `index` (default 0), or null if none. */
  getGamepad(index = 0): GamepadState | null {
    const pad = this.padSnapshot()?.[index] ?? null;
    if (!pad) return null;
    return new GamepadStateImpl(pad, this.gamepadPrev.get(index) ?? [], this.gamepadCur.get(index) ?? []);
  }

  /** Connected gamepads — synthetic (injected) pads when present, else the navigator's. */
  private padSnapshot(): (Gamepad | null)[] | undefined {
    if (this.syntheticPads) {
      const out: (Gamepad | null)[] = new Array(Math.max(0, ...this.syntheticPads.keys()) + 1).fill(null);
      for (const [i, p] of this.syntheticPads) out[i] = p;
      return out;
    }
    return typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined;
  }

  // ── lifecycle (engine-driven) ─────────────────────────────────────────────────

  /** Commit accumulated events into this frame's snapshot. Called by Engine.tick(). */
  beginFrame(): void {
    // Keyboard edges: this frame reports what arrived since the last beginFrame.
    [this.downThisFrame, this.pendingDown] = [this.pendingDown, this.downThisFrame];
    [this.upThisFrame, this.pendingUp] = [this.pendingUp, this.upThisFrame];
    this.pendingDown.clear();
    this.pendingUp.clear();

    // Mouse button edges (copy + reset the pending arrays).
    for (let b = 0; b < 3; b++) {
      this.mouseDownThisFrame[b] = this.pendingMouseDown[b]!;
      this.mouseUpThisFrame[b] = this.pendingMouseUp[b]!;
      this.pendingMouseDown[b] = false;
      this.pendingMouseUp[b] = false;
    }

    // Mouse position/NDC from the latest move; delta + scroll from the accumulators.
    this.sampleMouse();
    this._mouseDelta.copy(this.pendingMove);
    this.pendingMove.set(0, 0);
    this._mouseScroll.copy(this.pendingScroll);
    this.pendingScroll.set(0, 0);

    // Gamepad: snapshot current button-pressed state so getButtonDown/Up can diff.
    this.pollGamepads();
  }

  /** Detach all listeners. */
  dispose(): void {
    for (const off of this.detach) off();
    this.detach = [];
  }

  // ── synthetic injection (drive input without DOM events: tooling, headless tests) ──
  // Each method mutates the same pending state the DOM handlers do, so the next
  // beginFrame() (i.e. the next Engine.tick) commits it identically.

  /** Press (`down: true`) or release a key by its `KeyCode` name (e.g. 'Space', 'W'). */
  injectKey(key: KeyCode, down: boolean): void {
    if (down) {
      if (!this.held.has(key)) {
        this.held.add(key);
        this.pendingDown.add(key);
      }
    } else {
      this.held.delete(key);
      this.pendingUp.add(key);
    }
  }

  /** Move the pointer to canvas-relative pixels (top-left origin); `dx/dy` is the raw delta. */
  injectMouseMove(x: number, y: number, dx = 0, dy = 0): void {
    this.injectedPos = { x, y };
    this.pendingMove.x += dx;
    this.pendingMove.y += dy;
    this.mouseSeen = true;
  }

  /** Press or release a mouse button (Unity index: 0 left, 1 right, 2 middle). */
  injectMouseButton(button: 0 | 1 | 2, down: boolean): void {
    if (down) {
      if (!this.mouseHeld[button]) {
        this.mouseHeld[button] = true;
        this.pendingMouseDown[button] = true;
      }
    } else {
      this.mouseHeld[button] = false;
      this.pendingMouseUp[button] = true;
    }
  }

  /** Accumulate a wheel delta for the next frame. */
  injectScroll(dx: number, dy: number): void {
    this.pendingScroll.x += dx;
    this.pendingScroll.y += dy;
  }

  /** Set (or clear, with `null`) a synthetic gamepad's pressed buttons + axes at `index`. */
  injectGamepad(index: number, state: { buttons?: boolean[]; axes?: number[] } | null): void {
    if (state === null) {
      this.syntheticPads?.delete(index);
      if (this.syntheticPads && this.syntheticPads.size === 0) this.syntheticPads = undefined;
      return;
    }
    (this.syntheticPads ??= new Map()).set(index, syntheticPad(index, state.buttons ?? [], state.axes ?? []));
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  private attach(): void {
    const t = this.target;
    if (!t) return; // headless: no DOM, every query stays neutral

    const on = <E extends Event>(target: EventTarget, type: string, fn: (e: E) => void) => {
      const handler = fn as EventListener;
      target.addEventListener(type, handler);
      this.detach.push(() => target.removeEventListener(type, handler));
    };

    on<KeyboardEvent>(t, 'keydown', (e) => {
      if (e.repeat) return; // ignore auto-repeat; getKey already covers "held"
      const key = codeToKey(e.code);
      if (!this.held.has(key)) {
        this.held.add(key);
        this.pendingDown.add(key);
      }
    });
    on<KeyboardEvent>(t, 'keyup', (e) => {
      const key = codeToKey(e.code);
      this.held.delete(key);
      this.pendingUp.add(key);
    });
    // Release everything when focus is lost, so keys don't stick.
    on(t, 'blur', () => this.clearHeld());

    const c = this.canvas;
    if (c) {
      on<MouseEvent>(c, 'mousemove', (e) => {
        this.clientX = e.clientX;
        this.clientY = e.clientY;
        this.pendingMove.x += e.movementX ?? 0;
        this.pendingMove.y += e.movementY ?? 0;
        this.mouseSeen = true;
      });
      on<MouseEvent>(c, 'mousedown', (e) => {
        const b = unityButton(e.button);
        if (!this.mouseHeld[b]) {
          this.mouseHeld[b] = true;
          this.pendingMouseDown[b] = true;
        }
      });
      // Buttons can release outside the canvas — listen on the window for mouseup.
      on<MouseEvent>(t, 'mouseup', (e) => {
        const b = unityButton(e.button);
        this.mouseHeld[b] = false;
        this.pendingMouseUp[b] = true;
      });
      on<WheelEvent>(c, 'wheel', (e) => {
        this.pendingScroll.x += e.deltaX;
        this.pendingScroll.y += e.deltaY;
      });

      // Single touch → the primary pointer (mouse button 0 + position), so the
      // pointer events (down/up/click/drag) work on mobile with no extra API.
      // One touch is tracked; extra fingers are ignored. (Set CSS `touch-action:
      // none` on the canvas to stop the page scrolling/zooming during play.)
      let activeTouch: number | undefined;
      let lastX = 0;
      let lastY = 0;
      const liveTouch = (e: TouchEvent, id: number): Touch | undefined => {
        for (let i = 0; i < e.touches.length; i++) if (e.touches[i]!.identifier === id) return e.touches[i]!;
        return undefined;
      };
      on<TouchEvent>(c, 'touchstart', (e) => {
        if (activeTouch !== undefined) return; // already tracking a finger
        const touch = e.changedTouches[0];
        if (!touch) return;
        activeTouch = touch.identifier;
        this.clientX = lastX = touch.clientX;
        this.clientY = lastY = touch.clientY;
        this.mouseSeen = true;
        if (!this.mouseHeld[0]) {
          this.mouseHeld[0] = true;
          this.pendingMouseDown[0] = true;
        }
      });
      on<TouchEvent>(c, 'touchmove', (e) => {
        if (activeTouch === undefined) return;
        const touch = liveTouch(e, activeTouch);
        if (!touch) return;
        this.pendingMove.x += touch.clientX - lastX;
        this.pendingMove.y += touch.clientY - lastY;
        this.clientX = lastX = touch.clientX;
        this.clientY = lastY = touch.clientY;
        this.mouseSeen = true;
      });
      const endTouch = (e: TouchEvent): void => {
        if (activeTouch === undefined || liveTouch(e, activeTouch)) return; // still down
        activeTouch = undefined;
        this.mouseHeld[0] = false;
        this.pendingMouseUp[0] = true;
      };
      on<TouchEvent>(c, 'touchend', endTouch);
      on<TouchEvent>(c, 'touchcancel', endTouch);
    }
  }

  /** Map the latest client coords into canvas pixels (y-up) + NDC. Delta is raw movement. */
  private sampleMouse(): void {
    const c = this.canvas;
    if (!c || !this.mouseSeen) return;
    if (this.injectedPos) {
      // Injected positions are already canvas-relative (top-left) — no rect needed.
      const w = c.clientWidth || c.width || 1;
      const h = c.clientHeight || c.height || 1;
      const { x: px, y: pyTop } = this.injectedPos;
      this._mousePosition.set(px, h - pyTop);
      this._mouseNdc.set((px / w) * 2 - 1, -(pyTop / h) * 2 + 1);
      return;
    }
    const rect = c.getBoundingClientRect();
    const w = rect.width || c.clientWidth || 1;
    const h = rect.height || c.clientHeight || 1;
    const px = this.clientX - rect.left;
    const pyTop = this.clientY - rect.top;
    this._mousePosition.set(px, h - pyTop); // bottom-left origin (Unity)
    this._mouseNdc.set((px / w) * 2 - 1, -(pyTop / h) * 2 + 1);
  }

  private pollGamepads(): void {
    const pads = this.padSnapshot();
    this.gamepadPrev = this.gamepadCur;
    this.gamepadCur = new Map();
    if (!pads) return;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad) this.gamepadCur.set(i, pad.buttons.map((b) => b.pressed));
    }
  }

  private clearHeld(): void {
    for (const key of this.held) this.pendingUp.add(key);
    this.held.clear();
  }
}

/** Live, queryable view over one navigator Gamepad with edge detection. */
class GamepadStateImpl implements GamepadState {
  readonly connected = true;
  readonly leftStick = new Vector2();
  readonly rightStick = new Vector2();
  readonly leftTrigger: number;
  readonly rightTrigger: number;

  constructor(
    private readonly pad: Gamepad,
    private readonly prev: boolean[],
    private readonly cur: boolean[],
  ) {
    const ax = pad.axes;
    this.leftStick.set(deadzone(ax[0] ?? 0), deadzone(-(ax[1] ?? 0))); // y up
    this.rightStick.set(deadzone(ax[2] ?? 0), deadzone(-(ax[3] ?? 0)));
    this.leftTrigger = pad.buttons[6]?.value ?? 0;
    this.rightTrigger = pad.buttons[7]?.value ?? 0;
  }

  getButton(button: GamepadButton): boolean {
    return this.pad.buttons[GAMEPAD_BUTTONS[button]]?.pressed ?? false;
  }
  getButtonDown(button: GamepadButton): boolean {
    const i = GAMEPAD_BUTTONS[button];
    return (this.cur[i] ?? false) && !(this.prev[i] ?? false);
  }
  getButtonUp(button: GamepadButton): boolean {
    const i = GAMEPAD_BUTTONS[button];
    return !(this.cur[i] ?? false) && (this.prev[i] ?? false);
  }
}

export interface GamepadState {
  readonly connected: boolean;
  /** Left stick, components in [-1..1] (y up), with a deadzone applied. */
  readonly leftStick: Vector2;
  readonly rightStick: Vector2;
  /** Analog trigger pulls, [0..1]. */
  readonly leftTrigger: number;
  readonly rightTrigger: number;
  getButton(button: GamepadButton): boolean;
  getButtonDown(button: GamepadButton): boolean;
  getButtonUp(button: GamepadButton): boolean;
}

/** Named buttons → standard-gamepad button indices (`mapping === 'standard'`). */
const GAMEPAD_BUTTONS: Record<GamepadButton, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  back: 8,
  start: 9,
  leftStickButton: 10,
  rightStickButton: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  guide: 16,
};

export type GamepadButton =
  | 'a'
  | 'b'
  | 'x'
  | 'y'
  | 'leftBumper'
  | 'rightBumper'
  | 'leftTrigger'
  | 'rightTrigger'
  | 'back'
  | 'start'
  | 'leftStickButton'
  | 'rightStickButton'
  | 'dpadUp'
  | 'dpadDown'
  | 'dpadLeft'
  | 'dpadRight'
  | 'guide';

/** DOM MouseEvent.button (0 left, 1 middle, 2 right) → Unity index (0 left, 1 right, 2 middle). */
function unityButton(domButton: number): 0 | 1 | 2 {
  return domButton === 1 ? 2 : domButton === 2 ? 1 : 0;
}

/** Build a navigator-Gamepad-shaped object from injected pressed buttons + axes. */
function syntheticPad(index: number, pressed: boolean[], axes: number[]): Gamepad {
  return {
    id: 'synthetic',
    index,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [...axes],
    buttons: pressed.map((p) => ({ pressed: p, touched: p, value: p ? 1 : 0 })),
    hapticActuators: [],
    vibrationActuator: null,
  } as unknown as Gamepad;
}

const GAMEPAD_DEADZONE = 0.12;
function deadzone(v: number): number {
  return Math.abs(v) < GAMEPAD_DEADZONE ? 0 : v;
}
function clampAxis(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** Map a physical `KeyboardEvent.code` to a Unity-style KeyCode name. */
function codeToKey(code: string): KeyCode {
  return (CODE_TO_KEY[code] ?? code) as KeyCode;
}

/**
 * `KeyboardEvent.code` → Unity-style name. Letters drop the `Key` prefix (`KeyW`
 * → `W`), digits become `Alpha<n>` (Unity), arrows become `<Dir>Arrow`, etc.
 * Codes not listed fall through as their raw `code` string (still queryable).
 */
const CODE_TO_KEY: Record<string, KeyCode> = {
  ...lettersToKeys(),
  ...digitsToKeys(),
  ...functionKeysToKeys(),
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  CapsLock: 'CapsLock',
  ArrowUp: 'UpArrow',
  ArrowDown: 'DownArrow',
  ArrowLeft: 'LeftArrow',
  ArrowRight: 'RightArrow',
  ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift',
  ControlLeft: 'LeftControl',
  ControlRight: 'RightControl',
  AltLeft: 'LeftAlt',
  AltRight: 'RightAlt',
  MetaLeft: 'LeftMeta',
  MetaRight: 'RightMeta',
  Minus: 'Minus',
  Equal: 'Equals',
  BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Backquote: 'BackQuote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
};

function lettersToKeys(): Record<string, KeyCode> {
  const out: Record<string, KeyCode> = {};
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    out[`Key${letter}`] = letter as KeyCode;
  }
  return out;
}
function digitsToKeys(): Record<string, KeyCode> {
  const out: Record<string, KeyCode> = {};
  for (let d = 0; d <= 9; d++) out[`Digit${d}`] = `Alpha${d}` as KeyCode;
  return out;
}
function functionKeysToKeys(): Record<string, KeyCode> {
  const out: Record<string, KeyCode> = {};
  for (let f = 1; f <= 12; f++) out[`F${f}`] = `F${f}` as KeyCode;
  return out;
}

/** Unity-style key names (a curated union); any other `code` string is also accepted. */
export type KeyCode =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'
  | 'Alpha0' | 'Alpha1' | 'Alpha2' | 'Alpha3' | 'Alpha4'
  | 'Alpha5' | 'Alpha6' | 'Alpha7' | 'Alpha8' | 'Alpha9'
  | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10' | 'F11' | 'F12'
  | 'UpArrow' | 'DownArrow' | 'LeftArrow' | 'RightArrow'
  | 'Space' | 'Return' | 'Escape' | 'Tab' | 'Backspace' | 'Delete' | 'Insert'
  | 'Home' | 'End' | 'PageUp' | 'PageDown' | 'CapsLock'
  | 'LeftShift' | 'RightShift' | 'LeftControl' | 'RightControl'
  | 'LeftAlt' | 'RightAlt' | 'LeftMeta' | 'RightMeta'
  | 'Minus' | 'Equals' | 'LeftBracket' | 'RightBracket' | 'Backslash'
  | 'Semicolon' | 'Quote' | 'BackQuote' | 'Comma' | 'Period' | 'Slash'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});
