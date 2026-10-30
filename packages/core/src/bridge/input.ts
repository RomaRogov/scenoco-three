/**
 * Input as the player's: DOM events where the player's would land, so the game's `Input` and any
 * HTML button read them alike. A key goes to whatever has focus, a pointer to what is under it.
 */

/** The bridge's input methods; `pass` lets frames go by — stepped while the clock is held. */
export function createInput(pass: (frames: number) => Promise<void>) {
  let pointerAt: [number, number] = [0, 0];
  let pointerTarget: Element | null = null;
  const key = (type: 'keydown' | 'keyup', name: string) => {
    const { code, key: text } = keyOf(name);
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, { code, key: text, bubbles: true, cancelable: true }));
  };
  /**
   * Refuse what is not a point of the window, with the call that works, before any event is sent — a
   * bad call otherwise reached the browser's elementFromPoint, whose error names neither.
   */
  const point = (call: string, x: unknown, y: unknown) => {
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      const [cx, cy] = [Math.round(innerWidth / 2), Math.round(innerHeight / 2)];
      const example = call === 'swipe' ? `swipe([${cx}, ${cy}], [${cx - 200}, ${cy}])` : `${call}(${cx}, ${cy})`;
      const shown = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
      throw new Error(`${call}: (${shown(x)}, ${shown(y)}) is not a point — x and y are numbers, pixels from the window's top-left: ${example}.`);
    }
  };
  const pointer = (type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, buttons: number) => {
    const target = type === 'pointerup' ? (pointerTarget ?? document.elementFromPoint(x, y)) : document.elementFromPoint(x, y);
    if (!target) throw new Error(`nothing on the page at (${x}, ${y}) — the window is ${innerWidth}×${innerHeight}.`);
    const init = { clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new PointerEvent(type, init));
    const mouse = { pointerdown: 'mousedown', pointermove: 'mousemove', pointerup: 'mouseup' }[type];
    target.dispatchEvent(new MouseEvent(mouse, init));
    if (type === 'pointerup' && target === pointerTarget) target.dispatchEvent(new MouseEvent('click', init));
    pointerAt = [x, y];
    if (type === 'pointerdown') pointerTarget = target;
    if (type === 'pointerup') pointerTarget = null;
  };

  return {
    /** Hold a key for `frames` frames — `"Space"`, `"ArrowLeft"`, `"a"`, `"Enter"` — then let it go. */
    async press(name: string, frames = 6) {
      key('keydown', name);
      await pass(frames);
      key('keyup', name);
      await pass(1);
    },
    keyDown(name: string) {
      key('keydown', name);
    },
    keyUp(name: string) {
      key('keyup', name);
    },
    /** Click or tap at a point of the window, in pixels from its top-left; then a frame passes. */
    async click(x: number, y: number) {
      point('click', x, y);
      pointer('pointerdown', x, y, 1);
      pointer('pointerup', x, y, 0);
      await pass(1);
    },
    pointerDown(x: number, y: number) {
      point('pointerDown', x, y);
      pointer('pointerdown', x, y, 1);
    },
    pointerMove(x: number, y: number) {
      point('pointerMove', x, y);
      pointer('pointermove', x, y, pointerTarget ? 1 : 0);
    },
    pointerUp() {
      pointer('pointerup', ...pointerAt, 0);
    },
    /** Press at `from`, drag to `to` over `frames` frames, lift: a swipe. */
    async swipe(from: [number, number], to: [number, number], frames = 8, ...more: unknown[]) {
      // Four numbers, as `adb input swipe` and Appium take them: the same swipe, written as two points.
      if (typeof from === 'number') {
        const [x1, y1, x2, y2] = [from, to, frames, ...more].map(String);
        throw new Error(`swipe takes two points, not four numbers: swipe([${x1}, ${y1}], [${x2}, ${y2}]).`);
      }
      const pair = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2;
      if (!pair(from) || !pair(to)) throw new Error('swipe takes two points, each [x, y] in pixels from the window\'s top-left: swipe([x, y], [x, y], frames = 8).');
      point('swipe', ...from);
      point('swipe', ...to);
      if (!Number.isInteger(frames) || frames < 1) throw new Error(`swipe: frames is a whole number of frames, 1 or more, not ${String(frames)}.`);
      pointer('pointerdown', from[0], from[1], 1);
      for (let i = 1; i <= frames; i++) {
        pointer('pointermove', from[0] + ((to[0] - from[0]) * i) / frames, from[1] + ((to[1] - from[1]) * i) / frames, 1);
        await pass(1);
      }
      pointer('pointerup', to[0], to[1], 0);
      await pass(1);
    },
  };
}

/** A key by the name Playwright uses — "Space", "ArrowLeft", "a", "7" — as the DOM's code and key. */
function keyOf(name: string): { code: string; key: string } {
  if (name === ' ' || name === 'Space') return { code: 'Space', key: ' ' };
  if (/^[a-z]$/i.test(name)) return { code: `Key${name.toUpperCase()}`, key: name };
  if (/^\d$/.test(name)) return { code: `Digit${name}`, key: name };
  if (name === 'Shift' || name === 'Control' || name === 'Alt' || name === 'Meta') return { code: `${name}Left`, key: name };
  return { code: name, key: name };
}
