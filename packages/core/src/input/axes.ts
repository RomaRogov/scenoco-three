import { KeyCode, MouseButton } from './KeyCode.js';

/**
 * Unity's default Input Manager entries, as a table rather than a project setting.
 *
 * Unity ships a list of named axes — `Horizontal`, `Jump`, `Fire1` — and every tutorial, every
 * asset and every controller script is written against those names. `Input.getAxis('Horizontal')`
 * is therefore the spelling a reader already knows, and the one a model guesses first; the pair
 * of key codes this used to take was a spelling only this framework had.
 *
 * The bindings below are Unity's own defaults. They are a starting point, not a rule: an axis can
 * be driven directly with {@link InputClass.setAxis} — that is how a virtual joystick, a gamepad
 * or a replay feeds the same code the keyboard feeds.
 */
export interface AxisBinding {
  /** Keys that drive the axis to -1. */
  readonly negative?: readonly KeyCode[];
  /** Keys that drive the axis to +1. */
  readonly positive?: readonly KeyCode[];
  /** A mouse button that also counts as pressed, for the `Fire` entries. */
  readonly mouse?: MouseButton;
  /**
   * How fast the value moves toward the key's target, in units per second. Unity's default for a
   * keyboard axis is 3, which is why a Unity character eases into a run rather than snapping.
   */
  readonly sensitivity: number;
  /** How fast it falls back to 0 once nothing is held, in units per second. Unity's default is 3. */
  readonly gravity: number;
}

export const AXES = {
  Horizontal: {
    negative: [KeyCode.A, KeyCode.LeftArrow],
    positive: [KeyCode.D, KeyCode.RightArrow],
    sensitivity: 3,
    gravity: 3,
  },
  Vertical: {
    negative: [KeyCode.S, KeyCode.DownArrow],
    positive: [KeyCode.W, KeyCode.UpArrow],
    sensitivity: 3,
    gravity: 3,
  },
  Fire1: { positive: [KeyCode.LeftControl], mouse: MouseButton.Left, sensitivity: 1000, gravity: 1000 },
  Fire2: { positive: [KeyCode.LeftAlt], mouse: MouseButton.Right, sensitivity: 1000, gravity: 1000 },
  Fire3: { positive: [KeyCode.LeftCommand], mouse: MouseButton.Middle, sensitivity: 1000, gravity: 1000 },
  Jump: { positive: [KeyCode.Space], sensitivity: 1000, gravity: 1000 },
  Submit: { positive: [KeyCode.Return, KeyCode.Space], sensitivity: 1000, gravity: 1000 },
  Cancel: { positive: [KeyCode.Escape], sensitivity: 1000, gravity: 1000 },
} as const satisfies Record<string, AxisBinding>;

/**
 * The mouse axes, which are a movement this frame rather than a key being held.
 *
 * Unity reports them through the same `GetAxis` call, already scaled by a sensitivity of 0.1, so
 * a full screen width is a number of tens rather than of hundreds. Neither is smoothed here: the
 * delta *is* the frame's movement, and smoothing a delta twice is how a look control gets soggy.
 */
export const MOUSE_AXES = ['Mouse X', 'Mouse Y', 'Mouse ScrollWheel'] as const;

/** How much of a mouse movement one unit of axis is. Unity's default sensitivity for these. */
export const MOUSE_SENSITIVITY = 0.1;

/** Every name {@link InputClass.getAxis} accepts. */
export type Axis = keyof typeof AXES | (typeof MOUSE_AXES)[number];

/**
 * Every name {@link InputClass.getButton} accepts — the entries that are pressed rather than
 * pushed in a direction. `Horizontal` is an axis and not a button; `Jump` is both, exactly as in
 * Unity, where `GetAxis("Jump")` is a legal if unusual thing to write.
 */
export type Button = Extract<Axis, 'Fire1' | 'Fire2' | 'Fire3' | 'Jump' | 'Submit' | 'Cancel'>;

/** The names, for a diagnostic or a tool that lists them. */
export const AXIS_NAMES: readonly Axis[] = [...Object.keys(AXES), ...MOUSE_AXES] as Axis[];
export const BUTTON_NAMES: readonly Button[] = ['Fire1', 'Fire2', 'Fire3', 'Jump', 'Submit', 'Cancel'];
