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
  /** How fast the value moves toward the key's target, in units per second. */
  readonly sensitivity: number;
  /** How fast it falls back to 0 once nothing is held, in units per second. */
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
 * The mouse axes — this frame's movement rather than a key being held, so they are scaled by
 * {@link MOUSE_SENSITIVITY} and never smoothed. Smoothing a delta is how a look control gets soggy.
 */
export const MOUSE_AXES = ['Mouse X', 'Mouse Y', 'Mouse ScrollWheel'] as const;

/** How much of a mouse movement one unit of axis is. Unity's default sensitivity for these. */
export const MOUSE_SENSITIVITY = 0.1;

/** Every name {@link InputClass.getAxis} accepts. */
export type Axis = keyof typeof AXES | (typeof MOUSE_AXES)[number];

/** Every name {@link InputClass.getButton} accepts — pressed rather than pushed in a direction. */
export type Button = Extract<Axis, 'Fire1' | 'Fire2' | 'Fire3' | 'Jump' | 'Submit' | 'Cancel'>;

/** The names, for a diagnostic or a tool that lists them. */
export const AXIS_NAMES: readonly Axis[] = [...Object.keys(AXES), ...MOUSE_AXES] as Axis[];
export const BUTTON_NAMES: readonly Button[] = ['Fire1', 'Fire2', 'Fire3', 'Jump', 'Submit', 'Cancel'];
