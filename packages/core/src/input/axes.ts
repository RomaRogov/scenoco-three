import { KeyCode, MouseButton } from './KeyCode.js';

/**
 * One of Unity's named Input Manager axes — `Horizontal`, `Jump`, `Fire1`.
 *
 * The bindings in {@link AXES} are Unity's own defaults, and a starting point rather than a
 * rule: {@link InputClass.setAxis} drives an axis directly, which is how a virtual joystick, a
 * gamepad or a replay feeds the code the keyboard feeds.
 */
export interface AxisBinding {
  /** Keys that drive the axis to -1. */
  readonly negative?: readonly KeyCode[];
  /** Keys that drive the axis to +1. */
  readonly positive?: readonly KeyCode[];
  /** A mouse button that also counts as pressed, for the `Fire` entries. */
  readonly mouse?: MouseButton;
  /**
   * A gamepad stick's axis that also drives it, by its index in the browser's standard layout — 0 the
   * left stick across, 1 down it — `invert` for up as +1. Read as it is, not eased: a stick is analog.
   */
  readonly stick?: { readonly axis: number; readonly invert?: boolean };
  /** How fast the value moves toward the key's target, in units per second. */
  readonly sensitivity: number;
  /** How fast it falls back to 0 once nothing is held, in units per second. */
  readonly gravity: number;
}

/** @internal the default bindings behind every named axis; read them through `Input.getAxis`. */
export const AXES = {
  // Unity's, with a gamepad's left stick and — not Unity's, but where a thumb goes — its d-pad.
  Horizontal: {
    negative: [KeyCode.A, KeyCode.LeftArrow, KeyCode.JoystickButton14],
    positive: [KeyCode.D, KeyCode.RightArrow, KeyCode.JoystickButton15],
    stick: { axis: 0 },
    sensitivity: 3,
    gravity: 3,
  },
  Vertical: {
    negative: [KeyCode.S, KeyCode.DownArrow, KeyCode.JoystickButton13],
    positive: [KeyCode.W, KeyCode.UpArrow, KeyCode.JoystickButton12],
    stick: { axis: 1, invert: true },
    sensitivity: 3,
    gravity: 3,
  },
  // Unity's joystick buttons for each: A fires and submits, B is the second fire and cancels.
  Fire1: { positive: [KeyCode.LeftControl, KeyCode.JoystickButton0], mouse: MouseButton.Left, sensitivity: 1000, gravity: 1000 },
  Fire2: { positive: [KeyCode.LeftAlt, KeyCode.JoystickButton1], mouse: MouseButton.Right, sensitivity: 1000, gravity: 1000 },
  Fire3: { positive: [KeyCode.LeftCommand, KeyCode.JoystickButton2], mouse: MouseButton.Middle, sensitivity: 1000, gravity: 1000 },
  Jump: { positive: [KeyCode.Space, KeyCode.JoystickButton3], sensitivity: 1000, gravity: 1000 },
  Submit: { positive: [KeyCode.Return, KeyCode.Space, KeyCode.JoystickButton0], sensitivity: 1000, gravity: 1000 },
  Cancel: { positive: [KeyCode.Escape, KeyCode.JoystickButton1], sensitivity: 1000, gravity: 1000 },
} as const satisfies Record<string, AxisBinding>;

/**
 * The mouse axes — this frame's movement rather than a key being held, so they are scaled by
 * {@link MOUSE_SENSITIVITY} and never smoothed. Smoothing a delta is how a look control gets soggy.
 */
export const MOUSE_AXES = ['Mouse X', 'Mouse Y', 'Mouse ScrollWheel'] as const;

/** A stick's travel read as 0, from the middle, as a share of full: Unity's `dead` for joystick axes. */
export const STICK_DEAD_ZONE = 0.19;

/** How much of a mouse movement one unit of axis is. Unity's default sensitivity for these. */
export const MOUSE_SENSITIVITY = 0.1;

/** Every name {@link InputClass.getAxis} accepts. */
export type AxisName = keyof typeof AXES | (typeof MOUSE_AXES)[number];

/** Every name {@link InputClass.getButton} accepts — pressed rather than pushed in a direction. */
export type ButtonName = Extract<AxisName, 'Fire1' | 'Fire2' | 'Fire3' | 'Jump' | 'Submit' | 'Cancel'>;

/** The names, for a diagnostic or a tool that lists them. */
export const AXIS_NAMES: readonly AxisName[] = [...Object.keys(AXES), ...MOUSE_AXES] as AxisName[];
export const BUTTON_NAMES: readonly ButtonName[] = ['Fire1', 'Fire2', 'Fire3', 'Jump', 'Submit', 'Cancel'];
