import { afterEach, describe, expect, it } from 'vitest';
import { Input } from '@scenoco-three/core';

afterEach(() => Input.clear());

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
});
