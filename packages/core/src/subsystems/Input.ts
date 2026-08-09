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
  /** Button held — Unity convention: {@link MouseButton} (0 left, 1 right, 2 middle). */
  getMouseButton(button: MouseButton): boolean {
    return this.mouseHeld[button] ?? false;
  }
  getMouseButtonDown(button: MouseButton): boolean {
    return this.mouseDownThisFrame[button] ?? false;
  }
  getMouseButtonUp(button: MouseButton): boolean {
    return this.mouseUpThisFrame[button] ?? false;
  }

  // ── virtual axes (Unity parity) ──────────────────────────────────────────────

  /** Range [-1..1] from arrows/WASD plus the gamepad left stick. */
  getAxis(axis: Axis): number {
    const pad = this.getGamepad(0);
    if (axis === Axis.Horizontal) {
      const keys =
        (this.getKey(KeyCode.D) || this.getKey(KeyCode.RightArrow) ? 1 : 0) -
        (this.getKey(KeyCode.A) || this.getKey(KeyCode.LeftArrow) ? 1 : 0);
      return clampAxis(keys + (pad?.leftStick.x ?? 0));
    }
    const keys =
      (this.getKey(KeyCode.W) || this.getKey(KeyCode.UpArrow) ? 1 : 0) -
      (this.getKey(KeyCode.S) || this.getKey(KeyCode.DownArrow) ? 1 : 0);
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

  /** Press or release a mouse button ({@link MouseButton}). */
  injectMouseButton(button: MouseButton, down: boolean): void {
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
    // Release everything when focus is lost, so nothing sticks. Buttons matter as
    // much as keys here: a press that ends outside the page (alt-tab, a drag into
    // another window) delivers no mouseup, and a mouse button stuck "held" makes
    // the pointer dispatcher treat every later cursor move as a drag forever.
    on(t, 'blur', () => this.releaseAll());

    const c = this.canvas;
    if (c) {
      on<MouseEvent>(c, 'mousemove', (e) => {
        this.pointerAt(e.clientX, e.clientY);
        this.pendingMove.x += e.movementX ?? 0;
        this.pendingMove.y += e.movementY ?? 0;
      });
      on<MouseEvent>(c, 'mousedown', (e) => {
        // Take the position from the press itself. A press is not always preceded
        // by a move — the page can load or regain focus with the cursor already
        // over the canvas — and without this the first click of a session would
        // raycast through a stale (0,0) NDC, i.e. silently miss whatever was
        // actually clicked. Every mouse event carries clientX/Y, so use them.
        this.pointerAt(e.clientX, e.clientY);
        const b = unityButton(e.button);
        if (!this.mouseHeld[b]) {
          this.mouseHeld[b] = true;
          this.pendingMouseDown[b] = true;
        }
      });
      // Buttons can release outside the canvas — listen on the window for mouseup.
      on<MouseEvent>(t, 'mouseup', (e) => {
        this.pointerAt(e.clientX, e.clientY);
        const b = unityButton(e.button);
        this.mouseHeld[b] = false;
        this.pendingMouseUp[b] = true;
      });
      on<WheelEvent>(c, 'wheel', (e) => {
        this.pointerAt(e.clientX, e.clientY);
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
        lastX = touch.clientX;
        lastY = touch.clientY;
        this.pointerAt(touch.clientX, touch.clientY);
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
        lastX = touch.clientX;
        lastY = touch.clientY;
        this.pointerAt(touch.clientX, touch.clientY);
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

  /**
   * Record where the pointer is, from any event that carries a position (move,
   * press, release, wheel, touch). Kept in raw client coords; `sampleMouse`
   * converts to canvas/NDC space once per frame.
   */
  private pointerAt(clientX: number, clientY: number): void {
    this.clientX = clientX;
    this.clientY = clientY;
    this.mouseSeen = true;
  }

  /**
   * Release every held key and mouse button, reporting an up edge for each so a
   * component's `getKeyUp`/`getMouseButtonUp` still sees the release it would
   * have got. Used on focus loss.
   */
  private releaseAll(): void {
    for (const key of this.held) this.pendingUp.add(key);
    this.held.clear();
    for (const button of MOUSE_BUTTONS) {
      if (!this.mouseHeld[button]) continue;
      this.mouseHeld[button] = false;
      this.pendingMouseUp[button] = true;
    }
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

/**
 * Standard-gamepad face/shoulder/dpad buttons, by name
 * (`pad.getButtonDown(GamepadButton.A)`). Closed, like {@link KeyCode}.
 */
export const GamepadButton = {
  A: 'a',
  B: 'b',
  X: 'x',
  Y: 'y',
  LeftBumper: 'leftBumper',
  RightBumper: 'rightBumper',
  LeftTrigger: 'leftTrigger',
  RightTrigger: 'rightTrigger',
  Back: 'back',
  Start: 'start',
  LeftStickButton: 'leftStickButton',
  RightStickButton: 'rightStickButton',
  DpadUp: 'dpadUp',
  DpadDown: 'dpadDown',
  DpadLeft: 'dpadLeft',
  DpadRight: 'dpadRight',
  Guide: 'guide',
} as const;

export type GamepadButton = (typeof GamepadButton)[keyof typeof GamepadButton];

/**
 * Mouse buttons, Unity's numbering (the values the `getMouseButton*` queries and
 * `PointerEventData.button` use). `MouseButton.Right` is 1, **not** the DOM's 2 —
 * the DOM order is remapped on the way in (see `unityButton`).
 */
export const MouseButton = {
  Left: 0,
  Right: 1,
  Middle: 2,
} as const;

export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];

/** Every mouse button, in Unity index order — the set the pointer dispatcher walks. */
export const MOUSE_BUTTONS: readonly MouseButton[] = [MouseButton.Left, MouseButton.Right, MouseButton.Middle];

/** The virtual axes {@link InputManager.getAxis} understands (Unity's default two). */
export const Axis = {
  Horizontal: 'Horizontal',
  Vertical: 'Vertical',
} as const;

export type Axis = (typeof Axis)[keyof typeof Axis];

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

/**
 * Map a physical `KeyboardEvent.code` to a Unity-style KeyCode name. A code with
 * no member falls through as its raw string: it still counts as held (so
 * `anyKey` sees it) but no `KeyCode` can name it, which is the point of the
 * closed enum.
 */
function codeToKey(code: string): string {
  return CODE_TO_KEY[code] ?? code;
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
  ...numpadToKeys(),
  Space: 'Space',
  Enter: 'Return',
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
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  PrintScreen: 'Print',
  ContextMenu: 'Menu',
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
function numpadToKeys(): Record<string, KeyCode> {
  const out: Record<string, KeyCode> = {
    NumpadDecimal: 'KeypadPeriod',
    NumpadDivide: 'KeypadDivide',
    NumpadMultiply: 'KeypadMultiply',
    NumpadSubtract: 'KeypadMinus',
    NumpadAdd: 'KeypadPlus',
    NumpadEnter: 'KeypadEnter',
  };
  for (let d = 0; d <= 9; d++) out[`Numpad${d}`] = `Keypad${d}` as KeyCode;
  return out;
}

/**
 * Unity-style key names — the one spelling you author with
 * (`input.getKeyDown(KeyCode.Space)`). **Closed**: there is no raw-string escape
 * hatch, so a misspelled key is a compile error rather than a control that
 * silently never fires. Each member's value *is* its name, so the wire/XML form
 * and the runtime value are the same readable string ({@link ValueType} style).
 *
 * A physical key with no member here still lands in the held set under its raw
 * `KeyboardEvent.code` (so `anyKey` sees it) — it simply isn't queryable by name.
 * If you need one, add it here and to `CODE_TO_KEY`.
 */
export const KeyCode = {
  A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H', I: 'I',
  J: 'J', K: 'K', L: 'L', M: 'M', N: 'N', O: 'O', P: 'P', Q: 'Q', R: 'R',
  S: 'S', T: 'T', U: 'U', V: 'V', W: 'W', X: 'X', Y: 'Y', Z: 'Z',

  Alpha0: 'Alpha0', Alpha1: 'Alpha1', Alpha2: 'Alpha2', Alpha3: 'Alpha3', Alpha4: 'Alpha4',
  Alpha5: 'Alpha5', Alpha6: 'Alpha6', Alpha7: 'Alpha7', Alpha8: 'Alpha8', Alpha9: 'Alpha9',

  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',

  UpArrow: 'UpArrow', DownArrow: 'DownArrow', LeftArrow: 'LeftArrow', RightArrow: 'RightArrow',

  Space: 'Space', Return: 'Return', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', CapsLock: 'CapsLock',

  LeftShift: 'LeftShift', RightShift: 'RightShift',
  LeftControl: 'LeftControl', RightControl: 'RightControl',
  LeftAlt: 'LeftAlt', RightAlt: 'RightAlt',
  LeftMeta: 'LeftMeta', RightMeta: 'RightMeta',

  Minus: 'Minus', Equals: 'Equals', LeftBracket: 'LeftBracket', RightBracket: 'RightBracket',
  Backslash: 'Backslash', Semicolon: 'Semicolon', Quote: 'Quote', BackQuote: 'BackQuote',
  Comma: 'Comma', Period: 'Period', Slash: 'Slash',

  // Numpad — distinct physical keys, so they need their own names (Unity's
  // Keypad*). Without them a numpad press would be unqueryable now the union is closed.
  Keypad0: 'Keypad0', Keypad1: 'Keypad1', Keypad2: 'Keypad2', Keypad3: 'Keypad3', Keypad4: 'Keypad4',
  Keypad5: 'Keypad5', Keypad6: 'Keypad6', Keypad7: 'Keypad7', Keypad8: 'Keypad8', Keypad9: 'Keypad9',
  KeypadPeriod: 'KeypadPeriod', KeypadDivide: 'KeypadDivide', KeypadMultiply: 'KeypadMultiply',
  KeypadMinus: 'KeypadMinus', KeypadPlus: 'KeypadPlus', KeypadEnter: 'KeypadEnter',

  NumLock: 'NumLock', ScrollLock: 'ScrollLock', Pause: 'Pause', Print: 'Print', Menu: 'Menu',
} as const;

/** A Unity-style key name — the value side of {@link KeyCode}. */
export type KeyCode = (typeof KeyCode)[keyof typeof KeyCode];

/**
 * To author a keybinding as an XML attribute, register it where you use it —
 * `const Key = enumOf('KeyCode', KeyCode)`, then `@property({ type: Key })`.
 * It is deliberately not registered here: the XSD exporter emits every
 * registered enum into every schema, so registering a 100-member table nothing
 * references would bloat each project's generated schema for nothing.
 */

/**
 * Resolve a key **name** that arrived as an untyped string (an editor/MCP
 * command, a config file, a save game) to a `KeyCode`, or `undefined` if it
 * isn't one. Boundaries that take input from outside the type system call this
 * so a typo surfaces as an error rather than a key that never fires.
 */
export function keyCodeFromName(name: string): KeyCode | undefined {
  return Object.hasOwn(KeyCode, name) ? (name as KeyCode) : undefined;
}

/** Every key name, in declaration order — for error messages and editor pickers. */
export const KEY_CODES: readonly KeyCode[] = Object.values(KeyCode);
