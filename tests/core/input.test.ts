import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, KeyCode } from '@scenoco-three/core';

afterEach(() => {
  Input.clear();
  vi.unstubAllGlobals();
});

/** A pointer event on a page element, as the document-level listener receives it. */
function pointer(type: 'down' | 'up', name: string | null, pointerId = 1): void {
  const target = { closest: () => (name ? { getAttribute: () => name } : null) };
  const handlers = Input as unknown as Record<string, (event: object) => void>;
  handlers[type === 'down' ? 'onPagePointerDown' : 'onPointerUp']!({ target, pointerId, button: 0 });
}

describe('Input', () => {
  it('reads a page element with data-button as a virtual button, sampled per frame like a key', () => {
    pointer('down', 'Pause');
    Input.advance(1 / 60);
    expect(Input.getButtonDown('Pause')).toBe(true);
    expect(Input.getButton('Pause')).toBe(true);
    Input.advance(1 / 60);
    expect(Input.getButtonDown('Pause')).toBe(false); // held: the edge is the change, not the state

    pointer('up', null);
    Input.advance(1 / 60);
    expect(Input.getButtonUp('Pause')).toBe(true);

    // A tap shorter than a frame still goes down for one frame.
    pointer('down', 'Pause', 2);
    pointer('up', null, 2);
    Input.advance(1 / 60);
    expect(Input.getButtonDown('Pause')).toBe(true);

    // Enter on a focused button, or a script's button.click(): a click no pointer made presses it
    // once; a pointer's own click, already pressed at pointerdown, adds nothing.
    const click = (detail: number) =>
      (Input as unknown as Record<string, (event: object) => void>).onPageClick!({ target: { closest: () => ({ getAttribute: () => 'Pause' }) }, detail });
    Input.advance(1 / 60);
    click(0);
    Input.advance(1 / 60);
    expect(Input.getButtonDown('Pause')).toBe(true);
    Input.advance(1 / 60);
    click(1);
    Input.advance(1 / 60);
    expect(Input.getButtonDown('Pause')).toBe(false);
  });

  it('fires a named button once for a key tapped within one frame', () => {
    const keys = Input as unknown as Record<string, (event: object) => void>;
    keys.onKeyDown!({ code: 'Space', repeat: false });
    keys.onKeyUp!({ code: 'Space' });
    Input.advance(1 / 60);
    expect(Input.getButtonDown('Jump')).toBe(true);
    Input.endFrame();
    Input.advance(1 / 60);
    expect(Input.getButtonDown('Jump')).toBe(false);
  });

  it('lets an axis be driven from outside — a virtual stick — and released back to the keys', () => {
    Input.setAxis('Horizontal', 0.5);
    expect(Input.getAxis('Horizontal')).toBe(0.5);
    Input.setAxis('Horizontal', null);
    expect(Input.getAxis('Horizontal')).toBe(0);
  });

  it("reads a gamepad as Unity does: its buttons are keys, its left stick and d-pad feed the named axes", () => {
    // A standard-layout pad, as navigator.getGamepads hands it out: polled, never pushed.
    const pad = { id: 'Xbox Wireless Controller', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    vi.stubGlobal('navigator', { getGamepads: () => [null, pad] });
    const frame = () => {
      Input.endFrame();
      Input.advance(1 / 60);
    };
    frame();
    expect(Input.getJoystickNames()).toEqual(['Xbox Wireless Controller']);

    // A: its key, and the named buttons Unity binds to it, on the frame it went down only.
    pad.buttons[0]!.pressed = true;
    frame();
    expect(Input.getKeyDown(KeyCode.JoystickButton0)).toBe(true);
    expect(Input.getButtonDown('Fire1')).toBe(true);
    expect(Input.getButtonDown('Submit')).toBe(true);
    frame();
    expect(Input.getKeyDown(KeyCode.JoystickButton0)).toBe(false);
    expect(Input.getKey(KeyCode.JoystickButton0)).toBe(true);
    pad.buttons[0]!.pressed = false;
    frame();
    expect(Input.getKeyUp(KeyCode.JoystickButton0)).toBe(true);
    expect(Input.getButtonUp('Fire1')).toBe(true);

    // The stick: analog and unsmoothed, nothing inside the dead zone, full travel still 1; up is +1.
    pad.axes[0] = 0.1;
    frame();
    expect(Input.getAxis('Horizontal')).toBe(0);
    pad.axes[0] = 1;
    pad.axes[1] = -0.595; // halfway between the dead zone and full, upward
    frame();
    expect(Input.getAxis('Horizontal')).toBe(1);
    expect(Input.getAxisRaw('Vertical')).toBeCloseTo(0.5);
    // A virtual stick on the page still wins while it is held.
    Input.setAxis('Horizontal', -0.25);
    expect(Input.getAxis('Horizontal')).toBe(-0.25);
    Input.setAxis('Horizontal', null);

    // The d-pad steps like a key.
    pad.axes[0] = 0;
    pad.buttons[14]!.pressed = true;
    frame();
    expect(Input.getAxisRaw('Horizontal')).toBe(-1);
  });
});
