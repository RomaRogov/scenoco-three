import { describe, expect, it } from 'vitest';
import { Component, Engine, InputManager, component, type PointerEventData } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

const ev = (type: string, props: Record<string, unknown>): Event => Object.assign(new Event(type), props);

describe('InputManager', () => {
  it('is neutral headless (no DOM) and nothing throws', () => {
    expect(typeof window).toBe('undefined');
    const input = new InputManager();
    input.beginFrame();
    expect(input.getKey('W')).toBe(false);
    expect(input.getMouseButton(0)).toBe(false);
    expect(input.getAxis('Horizontal')).toBe(0);
    expect(input.getGamepad(0)).toBeNull();
    input.dispose();
  });

  it('synthetic injection drives key edges and a bottom-left-origin mouse position (tooling/simulate)', () => {
    const canvas = { clientWidth: 200, clientHeight: 100 } as unknown as HTMLCanvasElement;
    const input = new InputManager({ canvas });
    input.injectKey('Space', true);
    input.injectMouseMove(100, 25); // canvas-relative top-left px
    input.injectMouseButton(0, true);
    input.beginFrame();
    expect(input.getKeyDown('Space')).toBe(true);
    expect(input.getMouseButtonDown(0)).toBe(true);
    expect(input.mousePosition.y).toBe(75); // bottom-left origin: 100 - 25
    expect(input.mouseNdc.x).toBeCloseTo(0); // centre x

    input.beginFrame(); // edge clears, hold persists
    expect(input.getKeyDown('Space')).toBe(false);
    expect(input.getKey('Space')).toBe(true);
    input.injectKey('Space', false);
    input.beginFrame();
    expect(input.getKeyUp('Space')).toBe(true);
    input.dispose();
  });

  it('maps DOM key codes to Unity names and drives the virtual axes', () => {
    const win = new EventTarget();
    const input = new InputManager({ target: win });
    for (const code of ['KeyW', 'Digit1', 'ArrowLeft', 'ShiftLeft', 'ArrowUp']) win.dispatchEvent(ev('keydown', { code }));
    input.beginFrame();
    expect(input.getKey('W')).toBe(true); // physical KeyW → Unity 'W'
    expect(input.getKey('Alpha1')).toBe(true);
    expect(input.getKey('LeftArrow')).toBe(true);
    expect(input.getKey('LeftShift')).toBe(true);
    expect(input.getAxis('Horizontal')).toBe(-1); // ArrowLeft held
    expect(input.getAxis('Vertical')).toBe(1); // ArrowUp held
    input.dispose();
  });
});

// A camera at z=5 looking down -Z at a box on the origin; the default pointer NDC
// (0,0) casts a ray straight through the box centre.
@component({ name: 'Clicker', description: 'Counts pointer down/up/click/drag' })
class Clicker extends Component {
  down = 0;
  up = 0;
  clicks = 0;
  drags = 0;
  lastDelta?: PointerEventData['delta'];
  override onPointerDown(): void { this.down++; }
  override onPointerUp(): void { this.up++; }
  override onPointerClick(): void { this.clicks++; }
  override onDrag(e: PointerEventData): void { this.drags++; this.lastDelta = e.delta; }
}

describe('engine: raycasting + pointer events', () => {
  const load = () => {
    const r = compileSceneXml(`<Scene><PerspectiveCamera position="0 0 5" /><Mesh id="target"><BoxGeometry /><Components><Clicker /></Components></Mesh></Scene>`);
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(r.scene));
    return engine;
  };

  it('raycasts the object under the pointer, dispatches down → drag → up + click over the same object', () => {
    const engine = load();
    expect(engine.raycast()[0]?.object).toBe(engine.findObject('target')); // centre ray hits the box
    const clicker = engine.findComponent('target', Clicker)!;

    engine.input.injectMouseButton(0, true);
    engine.tick(1 / 60);
    expect(clicker.down).toBe(1);

    engine.input.injectMouseMove(0, 0, 6, -4); // held, pointer moves (dx, dy)
    engine.tick(1 / 60);
    expect(clicker.drags).toBe(1);
    expect(clicker.lastDelta?.x).toBe(6);

    engine.input.injectMouseButton(0, false);
    engine.tick(1 / 60);
    expect(clicker.up).toBe(1);
    expect(clicker.clicks).toBe(1);
    engine.dispose();
  });

  it('fires onPointerUp but not onPointerClick when released off the pressed object', () => {
    const engine = load();
    const clicker = engine.findComponent('target', Clicker)!;
    engine.input.injectMouseButton(0, true);
    engine.tick(1 / 60);
    engine.findObject('target')!.position.set(1000, 1000, 1000); // move out of the ray before release
    engine.input.injectMouseButton(0, false);
    engine.tick(1 / 60);
    expect(clicker.up).toBe(1); // up still goes to the pressed object
    expect(clicker.clicks).toBe(0); // …but no click (released elsewhere)
    engine.dispose();
  });
});
