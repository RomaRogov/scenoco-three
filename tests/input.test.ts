import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '@scenoco-three/core';

// No DOM environment needed: InputManager takes an injectable `target`/`canvas`,
// so we drive it with Node's built-in EventTarget + plain Event objects carrying
// the few fields the handlers read (code, clientX/Y, button, deltaY).

const ev = (type: string, props: Record<string, unknown>): Event => Object.assign(new Event(type), props);

function fakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  return Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON() {} }),
    clientWidth: width,
    clientHeight: height,
  }) as unknown as HTMLCanvasElement;
}

describe('InputManager — keyboard (Unity naming + edge detection)', () => {
  it('reports down for one frame, held while pressed, up on release', () => {
    const win = new EventTarget();
    const input = new InputManager({ target: win });

    win.dispatchEvent(ev('keydown', { code: 'KeyW' }));
    input.beginFrame();
    expect(input.getKeyDown('W')).toBe(true); // physical KeyW → Unity 'W'
    expect(input.getKey('W')).toBe(true);
    expect(input.anyKey).toBe(true);

    input.beginFrame(); // no new events
    expect(input.getKeyDown('W')).toBe(false); // down is true for exactly one frame
    expect(input.getKey('W')).toBe(true); // still held

    win.dispatchEvent(ev('keyup', { code: 'KeyW' }));
    input.beginFrame();
    expect(input.getKeyUp('W')).toBe(true);
    expect(input.getKey('W')).toBe(false);
    expect(input.anyKey).toBe(false);

    input.dispose();
  });

  it('maps codes to Unity names (digits, arrows, modifiers, space)', () => {
    const win = new EventTarget();
    const input = new InputManager({ target: win });
    for (const code of ['Digit1', 'ArrowLeft', 'ShiftLeft', 'Space']) {
      win.dispatchEvent(ev('keydown', { code }));
    }
    input.beginFrame();
    expect(input.getKey('Alpha1')).toBe(true);
    expect(input.getKey('LeftArrow')).toBe(true);
    expect(input.getKey('LeftShift')).toBe(true);
    expect(input.getKey('Space')).toBe(true);
    input.dispose();
  });

  it('drives the Horizontal/Vertical virtual axes', () => {
    const win = new EventTarget();
    const input = new InputManager({ target: win });
    win.dispatchEvent(ev('keydown', { code: 'KeyD' }));
    win.dispatchEvent(ev('keydown', { code: 'ArrowUp' }));
    input.beginFrame();
    expect(input.getAxis('Horizontal')).toBe(1);
    expect(input.getAxis('Vertical')).toBe(1);
    input.dispose();
  });
});

describe('InputManager — mouse', () => {
  it('reports position (y-up), NDC, buttons and wheel', () => {
    const win = new EventTarget();
    const canvas = fakeCanvas(800, 600);
    const input = new InputManager({ target: win, canvas });

    canvas.dispatchEvent(ev('mousemove', { clientX: 400, clientY: 150 }));
    input.beginFrame();
    // pixels, bottom-left origin: y = 600 - 150
    expect(input.mousePosition.x).toBe(400);
    expect(input.mousePosition.y).toBe(450);
    // NDC: x at centre → 0; y above centre → +0.5
    expect(input.mouseNdc.x).toBeCloseTo(0);
    expect(input.mouseNdc.y).toBeCloseTo(0.5);

    canvas.dispatchEvent(ev('mousedown', { button: 0 }));
    input.beginFrame();
    expect(input.getMouseButtonDown(0)).toBe(true);
    expect(input.getMouseButton(0)).toBe(true);

    win.dispatchEvent(ev('mouseup', { button: 0 })); // release can land off-canvas
    input.beginFrame();
    expect(input.getMouseButtonUp(0)).toBe(true);
    expect(input.getMouseButton(0)).toBe(false);

    // Unity button convention: DOM right (button 2) → index 1; DOM middle (1) → index 2.
    canvas.dispatchEvent(ev('mousedown', { button: 2 }));
    canvas.dispatchEvent(ev('mousedown', { button: 1 }));
    input.beginFrame();
    expect(input.getMouseButton(1)).toBe(true); // right
    expect(input.getMouseButton(2)).toBe(true); // middle

    // Raw pointer movement feeds mouseDelta (for look controls).
    canvas.dispatchEvent(ev('mousemove', { clientX: 410, clientY: 150, movementX: 10, movementY: -4 }));
    input.beginFrame();
    expect(input.mouseDelta.x).toBe(10);
    expect(input.mouseDelta.y).toBe(-4);
    input.beginFrame();
    expect(input.mouseDelta.x).toBe(0); // resets each frame

    canvas.dispatchEvent(ev('wheel', { deltaX: 0, deltaY: 120 }));
    input.beginFrame();
    expect(input.mouseScrollDelta.y).toBe(120);
    input.beginFrame();
    expect(input.mouseScrollDelta.y).toBe(0); // resets each frame

    input.dispose();
  });
});

describe('InputManager — gamepad (named standard mapping)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes named buttons, sticks (y-up) and button edges', () => {
    const makeButtons = (pressed: number[]) =>
      Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: pressed.includes(i) ? 1 : 0 }));
    let pad = { connected: true, mapping: 'standard', index: 0, axes: [0.5, -0.8, 0, 0], buttons: makeButtons([0]) };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });

    const input = new InputManager({ target: new EventTarget() });

    input.beginFrame(); // prev empty → cur [a]
    const g1 = input.getGamepad(0)!;
    expect(g1.connected).toBe(true);
    expect(g1.getButton('a')).toBe(true);
    expect(g1.getButtonDown('a')).toBe(true); // pressed this frame
    expect(g1.leftStick.x).toBeCloseTo(0.5);
    expect(g1.leftStick.y).toBeCloseTo(0.8); // axis y inverted to up-positive

    input.beginFrame(); // still held
    expect(input.getGamepad(0)!.getButtonDown('a')).toBe(false);
    expect(input.getGamepad(0)!.getButton('a')).toBe(true);

    pad = { ...pad, buttons: makeButtons([]) }; // release a
    input.beginFrame();
    expect(input.getGamepad(0)!.getButtonUp('a')).toBe(true);

    input.dispose();
  });

  it('returns null when no gamepad is connected', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    const input = new InputManager({ target: new EventTarget() });
    expect(input.getGamepad(0)).toBeNull();
    input.dispose();
  });
});
