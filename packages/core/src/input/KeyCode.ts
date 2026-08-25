/**
 * Unity's `KeyCode` names mapped onto DOM `KeyboardEvent.code` values.
 *
 * `Input.getKey(KeyCode.W)` instead of `Input.getKey('KeyW')`: the compiler catches typos,
 * autocomplete lists what exists, and "find all references to `KeyCode.Space`" works.
 *
 * These are *physical* key positions, not the characters they produce — `KeyCode.W` is the
 * same key on QWERTY and AZERTY, which is what movement bindings want.
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
