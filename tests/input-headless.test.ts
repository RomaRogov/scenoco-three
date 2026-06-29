import { describe, expect, it } from 'vitest';
import { Engine, InputManager } from '@scenoco-three/core';

// Default (node) environment: no `window` — input must attach nothing and return
// neutral values, so the engine runs headless in tests/SSR without guards.
describe('InputManager — headless (no DOM)', () => {
  it('every query is neutral and nothing throws', () => {
    expect(typeof window).toBe('undefined');
    const input = new InputManager();
    input.beginFrame();
    expect(input.getKey('W')).toBe(false);
    expect(input.getKeyDown('Space')).toBe(false);
    expect(input.anyKey).toBe(false);
    expect(input.getMouseButton(0)).toBe(false);
    expect(input.mousePosition.x).toBe(0);
    expect(input.getAxis('Horizontal')).toBe(0);
    expect(input.getGamepad(0)).toBeNull();
    input.dispose();
  });

  it('a headless engine exposes input and ticks without a DOM', () => {
    const engine = new Engine();
    expect(engine.input).toBeInstanceOf(InputManager);
    expect(() => engine.tick(1 / 60)).not.toThrow();
    expect(engine.input.getKeyDown('Space')).toBe(false);
    engine.dispose();
  });
});

describe('InputManager — synthetic injection (tooling/simulate)', () => {
  it('injectKey drives getKeyDown → getKey → getKeyUp across frames', () => {
    const input = new InputManager(); // headless, but injection bypasses the DOM
    input.injectKey('Space', true);
    input.beginFrame();
    expect(input.getKeyDown('Space')).toBe(true);
    expect(input.getKey('Space')).toBe(true);

    input.beginFrame(); // edge clears, hold persists
    expect(input.getKeyDown('Space')).toBe(false);
    expect(input.getKey('Space')).toBe(true);

    input.injectKey('Space', false);
    input.beginFrame();
    expect(input.getKeyUp('Space')).toBe(true);
    expect(input.getKey('Space')).toBe(false);
  });

  it('injectMouseButton + injectMouseMove report a click and a position', () => {
    const canvas = { clientWidth: 200, clientHeight: 100 } as unknown as HTMLCanvasElement;
    const input = new InputManager({ canvas });
    input.injectMouseMove(100, 25); // canvas-relative top-left px
    input.injectMouseButton(0, true);
    input.beginFrame();
    expect(input.getMouseButtonDown(0)).toBe(true);
    expect(input.getMouseButton(0)).toBe(true);
    expect(input.mousePosition.x).toBe(100); // canvas px
    expect(input.mousePosition.y).toBe(75); // bottom-left origin: 100 - 25
    expect(input.mouseNdc.x).toBeCloseTo(0); // centre x
  });

  it('injectGamepad exposes a synthetic pad with buttons + axes', () => {
    const input = new InputManager();
    input.injectGamepad(0, { buttons: [true, false], axes: [0.5, 0] });
    input.beginFrame();
    const pad = input.getGamepad(0);
    expect(pad?.connected).toBe(true);
    expect(pad?.getButton('a')).toBe(true);
    expect(pad?.getButton('b')).toBe(false);
    expect(pad?.leftStick.x).toBeCloseTo(0.5);
    expect(input.getAxis('Horizontal')).toBeCloseTo(0.5); // pad stick feeds the virtual axis
  });
});
