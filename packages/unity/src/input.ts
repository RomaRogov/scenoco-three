/**
 * SceNoCo's named axes and buttons — Unity's Input Manager list, `Horizontal` to `Cancel` — as an
 * Input System actions asset: one action per name, bound to the keys, mouse buttons and gamepad
 * controls core's `AXES` gives it. Made the project-wide actions, so `Input.getAxis('Horizontal')`
 * ports as `InputSystem.actions["Horizontal"].ReadValue<float>()`.
 */
import { createHash } from 'node:crypto';

interface Axis {
  negative?: readonly string[];
  positive?: readonly string[];
  mouse?: number;
  stick?: { axis: number; invert?: boolean };
}

/** A gamepad button by its index in the browser's standard layout — SceNoCo's `JoystickButtonN`. */
const PAD = ['buttonSouth', 'buttonEast', 'buttonWest', 'buttonNorth', 'leftShoulder', 'rightShoulder', 'leftTrigger', 'rightTrigger', 'select', 'start', 'leftStickPress', 'rightStickPress', 'dpad/up', 'dpad/down', 'dpad/left', 'dpad/right'];
const MOUSE = ['leftButton', 'middleButton', 'rightButton'];
const KEYS: Record<string, string> = {
  ArrowUp: 'upArrow', ArrowDown: 'downArrow', ArrowLeft: 'leftArrow', ArrowRight: 'rightArrow', Enter: 'enter', Space: 'space',
  Escape: 'escape', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ControlLeft: 'leftCtrl', ControlRight: 'rightCtrl',
  AltLeft: 'leftAlt', AltRight: 'rightAlt', MetaLeft: 'leftMeta', MetaRight: 'rightMeta', ShiftLeft: 'leftShift', ShiftRight: 'rightShift',
};

/** A DOM key code — `KeyA`, `ArrowLeft`, `JoystickButton0` — as an Input System control path. */
export function controlPath(code: string): string | undefined {
  const pad = /^JoystickButton(\d+)$/.exec(code);
  if (pad) return PAD[Number(pad[1])] ? `<Gamepad>/${PAD[Number(pad[1])]}` : undefined;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return `<Keyboard>/${letter[1]!.toLowerCase()}`;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return `<Keyboard>/${digit[1]}`;
  if (/^F\d+$/.test(code)) return `<Keyboard>/${code.toLowerCase()}`;
  return KEYS[code] ? `<Keyboard>/${KEYS[code]}` : undefined;
}

/** A stable id from a name, as the asset wants one per action and binding. */
const id = (name: string) => {
  const h = createHash('sha1').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/** The `.inputactions` JSON for `axes` — core's `AXES`, as the snapshot carries it. */
export function inputActions(axes: Record<string, Axis>): string {
  const actions: object[] = [];
  const bindings: object[] = [];
  const bind = (action: string, path: string, extra: object = {}) =>
    bindings.push({ name: '', id: id(`${action}/${path}/${bindings.length}`), path, interactions: '', processors: '', groups: '', action, isComposite: false, isPartOfComposite: false, ...extra });
  for (const [name, axis] of Object.entries(axes)) {
    const both = !!(axis.negative?.length && axis.positive?.length) || !!axis.stick;
    actions.push({ name, type: both ? 'Value' : 'Button', id: id(name), expectedControlType: both ? 'Axis' : 'Button', processors: '', interactions: '', initialStateCheck: both });
    if (both) {
      // Keys pull it to -1 and +1, as the Input Manager's negative and positive buttons do.
      bind(name, '1DAxis', { name: 'Keys', isComposite: true });
      for (const [part, codes] of [['negative', axis.negative], ['positive', axis.positive]] as const)
        for (const code of codes ?? []) {
          const path = controlPath(code);
          if (path) bind(name, path, { name: part, isPartOfComposite: true });
        }
      if (axis.stick) bind(name, `<Gamepad>/leftStick/${axis.stick.axis === 0 ? 'x' : 'y'}`);
    } else {
      for (const code of axis.positive ?? []) {
        const path = controlPath(code);
        if (path) bind(name, path);
      }
      if (axis.mouse !== undefined && MOUSE[axis.mouse]) bind(name, `<Mouse>/${MOUSE[axis.mouse]}`);
    }
  }
  // The mouse axes: this frame's movement, as Unity's Mouse X and Y are.
  const mouseAxes: [string, string][] = [['Mouse X', '<Pointer>/delta/x'], ['Mouse Y', '<Pointer>/delta/y'], ['Mouse ScrollWheel', '<Mouse>/scroll/y']];
  for (const [name, path] of mouseAxes) {
    actions.push({ name, type: 'Value', id: id(name), expectedControlType: 'Axis', processors: '', interactions: '', initialStateCheck: false });
    bind(name, path);
  }
  return JSON.stringify({ name: 'SceNoCo', maps: [{ name: 'Game', id: id('Game'), actions, bindings }], controlSchemes: [] }, null, 4) + '\n';
}
