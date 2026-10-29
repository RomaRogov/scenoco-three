/**
 * Unity's `KeyCode` names mapped onto DOM `KeyboardEvent.code` values.
 *
 * These are *physical* key positions, not the characters they produce: `KeyCode.W` is the same
 * key on QWERTY and AZERTY, which is what movement bindings want. A gamepad's buttons are keys too,
 * as in Unity: `KeyCode.JoystickButton0`.
 */
export const KeyCode = {
  A: 'KeyA', B: 'KeyB', C: 'KeyC', D: 'KeyD', E: 'KeyE', F: 'KeyF', G: 'KeyG',
  H: 'KeyH', I: 'KeyI', J: 'KeyJ', K: 'KeyK', L: 'KeyL', M: 'KeyM', N: 'KeyN',
  O: 'KeyO', P: 'KeyP', Q: 'KeyQ', R: 'KeyR', S: 'KeyS', T: 'KeyT', U: 'KeyU',
  V: 'KeyV', W: 'KeyW', X: 'KeyX', Y: 'KeyY', Z: 'KeyZ',

  /** Unity spells the number row `Alpha0`..`Alpha9`. */
  Alpha0: 'Digit0', Alpha1: 'Digit1', Alpha2: 'Digit2', Alpha3: 'Digit3', Alpha4: 'Digit4',
  Alpha5: 'Digit5', Alpha6: 'Digit6', Alpha7: 'Digit7', Alpha8: 'Digit8', Alpha9: 'Digit9',

  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',

  UpArrow: 'ArrowUp', DownArrow: 'ArrowDown', LeftArrow: 'ArrowLeft', RightArrow: 'ArrowRight',

  Space: 'Space',
  /** The main Enter key. Unity calls it `Return`. */
  Return: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',

  LeftShift: 'ShiftLeft', RightShift: 'ShiftRight',
  LeftControl: 'ControlLeft', RightControl: 'ControlRight',
  LeftAlt: 'AltLeft', RightAlt: 'AltRight',
  LeftCommand: 'MetaLeft', RightCommand: 'MetaRight',

  Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backslash: 'Backslash',
  Semicolon: 'Semicolon', Quote: 'Quote', BackQuote: 'Backquote',
  LeftBracket: 'BracketLeft', RightBracket: 'BracketRight',
  Minus: 'Minus', Equals: 'Equal',

  /**
   * A gamepad's buttons, numbered as the browser's standard layout numbers them: 0 A, 1 B, 2 X, 3 Y
   * (on an Xbox pad; cross, circle, square, triangle on a PlayStation one), 4 LB, 5 RB, 6 LT, 7 RT,
   * 8 Back, 9 Start, 10 and 11 the sticks pressed, 12–15 the d-pad up, down, left, right. Any pad's.
   */
  JoystickButton0: 'JoystickButton0', JoystickButton1: 'JoystickButton1', JoystickButton2: 'JoystickButton2', JoystickButton3: 'JoystickButton3',
  JoystickButton4: 'JoystickButton4', JoystickButton5: 'JoystickButton5', JoystickButton6: 'JoystickButton6', JoystickButton7: 'JoystickButton7',
  JoystickButton8: 'JoystickButton8', JoystickButton9: 'JoystickButton9', JoystickButton10: 'JoystickButton10', JoystickButton11: 'JoystickButton11',
  JoystickButton12: 'JoystickButton12', JoystickButton13: 'JoystickButton13', JoystickButton14: 'JoystickButton14', JoystickButton15: 'JoystickButton15',
  JoystickButton16: 'JoystickButton16', JoystickButton17: 'JoystickButton17', JoystickButton18: 'JoystickButton18', JoystickButton19: 'JoystickButton19',
} as const;

/** The union of every value in {@link KeyCode}. This is what `Input` methods accept. */
export type KeyCode = (typeof KeyCode)[keyof typeof KeyCode];

/** Mouse button indices, matching the argument Unity's `Input.GetMouseButton` takes. */
export const MouseButton = {
  Left: 0,
  Middle: 1,
  Right: 2,
} as const;

/** The union of every value in {@link MouseButton}. */
export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];
