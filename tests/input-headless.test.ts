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
