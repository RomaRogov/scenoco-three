import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { AXES, AXIS_NAMES, BUTTON_NAMES, Engine, Input } from '@scenoco-three/core';

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

/**
 * A drag starts where the pointer went down.
 *
 * A finger has no hover: it lands with no move before it, so the last position known was where
 * the previous touch lifted, and the first move of the next one read as a jump across the whole
 * screen — anything steered by `mouseDelta` leapt on every new touch. Driven through real
 * listeners on a stand-in element, because the thing under test is what the events do.
 */
describe('the pointer', () => {
  it('measures a drag from the press, not from wherever the pointer last was', () => {
    const page = new EventTarget();
    const canvas = Object.assign(new EventTarget(), {
      tabIndex: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
    });
    const hadWindow = 'window' in globalThis;
    (globalThis as Record<string, unknown>).window ??= page;
    try {
      Input.attach(canvas as unknown as HTMLElement);
      const at = (type: string, x: number, y = 400) =>
        canvas.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, button: 0 }));

      at('pointermove', 20); // the last touch lifted over here
      Input.endFrame();
      at('pointerdown', 300); // the next one lands far away, with no move before it
      expect(Input.mouseDelta.x).toBe(0);
      at('pointermove', 310);
      expect(Input.mouseDelta.x).toBe(10);
      expect(Input.mousePosition.x).toBe(310);
    } finally {
      Input.detach();
      if (!hadWindow) delete (globalThis as Record<string, unknown>).window;
    }
  });
});

/**
 * A finger the browser takes back.
 *
 * On a phone a drag the page does not claim is taken for a scroll: the browser sends
 * `pointercancel` after a few pixels and no more moves. So the canvas claims every gesture —
 * `touch-action: none` — and a cancel is a release, or the button stayed held until the next tap.
 */
describe('a cancelled pointer', () => {
  it('is a released one', () => {
    const page = new EventTarget();
    const canvas = Object.assign(new EventTarget(), {
      tabIndex: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
    });
    const hadWindow = 'window' in globalThis;
    (globalThis as Record<string, unknown>).window ??= page;
    const target = (globalThis as unknown as { window: EventTarget }).window;
    try {
      Input.attach(canvas as unknown as HTMLElement);
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 10, clientY: 10, button: 0 }));
      expect(Input.getMouseButton(0)).toBe(true);
      target.dispatchEvent(Object.assign(new Event('pointercancel'), { button: 0 }));
      expect(Input.getMouseButton(0)).toBe(false);
    } finally {
      Input.detach();
      if (!hadWindow) delete (globalThis as Record<string, unknown>).window;
    }
  });

  it('never happens to the engine’s own canvas, which claims every gesture', () => {
    // A WebGL renderer does not construct in Node, so this pins the line rather than running it.
    const engine = readFileSync(fileURLToPath(new URL('../../packages/core/src/runtime/Engine.ts', import.meta.url)), 'utf8');
    expect(engine).toContain("this.canvas.style.touchAction = 'none';");
  });
});

/**
 * `camera.screenToWorldPoint` — Unity's `ScreenToWorldPoint`, and what a drag is built from.
 *
 * Pixels are not world units: how many of one make the other depends on the window, the fov and
 * the depth, so a drag in `mouseDelta` crawled on one screen and flew on another. Converting both
 * ends of the move at the thing's depth makes it follow the finger exactly, whatever the screen.
 */
describe('a screen point in the world', () => {
  const withScreen = (width: number, height: number, body: () => void) => {
    const was = Engine.current;
    Engine.current = { canvas: { clientWidth: width, clientHeight: height } } as unknown as Engine;
    try {
      body();
    } finally {
      Engine.current = was;
    }
  };

  it('lands on the view axis at the middle of the screen, at the depth asked for', () => {
    withScreen(400, 800, () => {
      const camera = new PerspectiveCamera(60, 0.5);
      camera.position.set(0, 0, 17);
      const point = camera.screenToWorldPoint(new Vector3(200, 400, 17));
      expect(point.x).toBeCloseTo(0, 6);
      expect(point.y).toBeCloseTo(0, 6);
      expect(point.z).toBeCloseTo(0, 6);
    });
  });

  it('turns a drag in pixels into the same distance on screen, whatever the window', () => {
    for (const [width, height] of [[390, 844], [1280, 800]] as const) {
      withScreen(width, height, () => {
        const camera = new PerspectiveCamera(60, width / height);
        camera.position.set(0, 0, 17);
        camera.updateProjectionMatrix();
        const a = camera.screenToWorldPoint(new Vector3(width / 2, height / 2, 17));
        const b = camera.screenToWorldPoint(new Vector3(width / 2 - 80, height / 2, 17));
        const moved = a.clone().add(new Vector3(b.x - a.x, 0, 0)).project(camera);
        expect(((moved.x + 1) / 2) * width).toBeCloseTo(width / 2 - 80, 3);
      });
    }
  });

  it('converts in place, like Vector3.unproject, unless handed a target', () => {
    withScreen(400, 800, () => {
      const camera = new OrthographicCamera(-2, 2, 4, -4, 0.1, 100);
      camera.position.set(0, 0, 10);
      const screen = new Vector3(400, 0, 10);
      expect(camera.screenToWorldPoint(screen)).toBe(screen);
      expect(screen.x).toBeCloseTo(2, 6);
      expect(screen.y).toBeCloseTo(4, 6);
      expect(screen.z).toBeCloseTo(0, 6);
      const kept = new Vector3(0, 800, 10);
      const into = camera.screenToWorldPoint(kept, new Vector3());
      expect(kept.x).toBe(0);
      expect(into.x).toBeCloseTo(-2, 6);
    });
  });
});
