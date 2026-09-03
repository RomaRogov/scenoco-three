import { afterEach, describe, expect, it } from 'vitest';
import { AXES, AXIS_NAMES, BUTTON_NAMES, Input } from '@scenoco-three/core';

afterEach(() => Input.clear());

/**
 * The named axes are Unity's, and they are the whole point of the change: gameplay is written
 * against `getAxis('Horizontal')`, which is the spelling every Unity tutorial uses, rather than
 * against a pair of key codes only this framework knew about.
 */
describe('the input axes', () => {
  it('carries Unity’s default entries, bound to Unity’s default keys', () => {
    expect(AXIS_NAMES).toContain('Horizontal');
    expect(AXIS_NAMES).toContain('Vertical');
    expect(BUTTON_NAMES).toEqual(['Fire1', 'Fire2', 'Fire3', 'Jump', 'Submit', 'Cancel']);
    // A/D and the arrows, both — as Unity binds them.
    expect(AXES.Horizontal.negative).toEqual(['KeyA', 'ArrowLeft']);
    expect(AXES.Horizontal.positive).toEqual(['KeyD', 'ArrowRight']);
    expect(AXES.Jump.positive).toEqual(['Space']);
  });

  /**
   * The override is what makes the axis names worth having beyond their familiarity: an
   * on-screen joystick, a gamepad or a replay drives the same call the keyboard drives, so none
   * of the gameplay code learns where the number came from.
   */
  it('lets an axis be driven from outside, and released back to the keys', () => {
    expect(Input.getAxis('Horizontal')).toBe(0);

    Input.setAxis('Horizontal', 0.5);
    expect(Input.getAxis('Horizontal')).toBe(0.5);
    // Unsmoothed: whatever is driving it has already decided the value.
    expect(Input.getAxisRaw('Horizontal')).toBe(0.5);
    expect(Input.overriddenAxes).toEqual(['Horizontal']);

    Input.setAxis('Horizontal', null);
    expect(Input.getAxis('Horizontal')).toBe(0);
    expect(Input.overriddenAxes).toEqual([]);
  });

  it('gives a driven button exactly one down edge and one up edge', () => {
    Input.setButton('Jump', true);
    Input.advance(1 / 60);
    expect(Input.getButton('Jump')).toBe(true);
    expect(Input.getButtonDown('Jump')).toBe(true);

    // Held, not pressed again: the edge is the change, not the state.
    Input.advance(1 / 60);
    expect(Input.getButton('Jump')).toBe(true);
    expect(Input.getButtonDown('Jump')).toBe(false);

    Input.setButton('Jump', false);
    Input.advance(1 / 60);
    expect(Input.getButton('Jump')).toBe(false);
    expect(Input.getButtonUp('Jump')).toBe(true);
  });

  it('forgets what was driven when the input is cleared', () => {
    // `clear` runs on `stop` and on detach. A virtual stick left pushed through a scene reload
    // is a character that walks into a wall with nobody touching the keyboard.
    Input.setAxis('Vertical', 1);
    Input.setButton('Fire1', true);
    Input.clear();
    expect(Input.getAxis('Vertical')).toBe(0);
    expect(Input.getButton('Fire1')).toBe(false);
  });
});
