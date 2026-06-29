import { describe, expect, it } from 'vitest';
import { Component, Engine, component, type PointerEventData } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

// Records the pointer hooks the engine dispatches via raycast.
@component({ name: 'Clicker', description: 'Counts pointer down/up/click' })
class Clicker extends Component {
  down = 0;
  up = 0;
  clicks = 0;
  drags = 0;
  lastPoint?: PointerEventData['point'];
  lastDelta?: PointerEventData['delta'];
  override onPointerDown(e: PointerEventData): void {
    this.down++;
    this.lastPoint = e.point;
  }
  override onPointerUp(): void {
    this.up++;
  }
  override onPointerClick(): void {
    this.clicks++;
  }
  override onDrag(e: PointerEventData): void {
    this.drags++;
    this.lastDelta = e.delta;
  }
}

// A camera at z=5 looking down -Z at a 1×1×1 box on the origin; the default
// pointer NDC (0,0) casts a ray straight through the box centre.
const sceneXml = `<Scene>
  <PerspectiveCamera position="0 0 5" />
  <Mesh id="target"><BoxGeometry /><Components><Clicker /></Components></Mesh>
</Scene>`;

const load = () => {
  const r = compileSceneXml(sceneXml);
  if (!r.ok) throw new Error('compile failed');
  const engine = new Engine();
  engine.loadScene(bundleScene(r.scene));
  return engine;
};

describe('engine: raycasting', () => {
  it('hits the object under the pointer (centre ray)', () => {
    const engine = load();
    const hits = engine.raycast();
    expect(hits[0]?.object).toBe(engine.findObject('target'));
    engine.dispose();
  });

  it('returns [] with no active camera', () => {
    const engine = new Engine();
    expect(engine.raycast()).toEqual([]);
    engine.dispose();
  });
});

describe('engine: pointer events', () => {
  it('dispatches onPointerDown, then onPointerUp + onPointerClick on release over the same object', () => {
    const engine = load();
    const clicker = engine.findComponent('target', Clicker)!;

    engine.input.injectMouseButton(0, true);
    engine.tick(1 / 60);
    expect(clicker.down).toBe(1);
    expect(clicker.up).toBe(0);
    expect(clicker.lastPoint).toBeDefined(); // carries the world hit point

    engine.input.injectMouseButton(0, false);
    engine.tick(1 / 60);
    expect(clicker.up).toBe(1);
    expect(clicker.clicks).toBe(1);
    engine.dispose();
  });

  it('dispatches onDrag with the movement delta while held after a press', () => {
    const engine = load();
    const clicker = engine.findComponent('target', Clicker)!;

    engine.input.injectMouseButton(0, true);
    engine.tick(1 / 60); // press over the target
    expect(clicker.drags).toBe(0); // no movement yet

    engine.input.injectMouseMove(0, 0, 6, -4); // held, pointer moves (dx, dy)
    engine.tick(1 / 60);
    expect(clicker.drags).toBe(1);
    expect(clicker.lastDelta?.x).toBe(6);
    expect(clicker.lastDelta?.y).toBe(-4);

    engine.input.injectMouseButton(0, false);
    engine.tick(1 / 60);
    expect(clicker.up).toBe(1);
    engine.dispose();
  });

  it('fires onPointerUp but not onPointerClick when released off the pressed object', () => {
    const engine = load();
    const clicker = engine.findComponent('target', Clicker)!;

    engine.input.injectMouseButton(0, true);
    engine.tick(1 / 60);
    expect(clicker.down).toBe(1);

    // Move the target out of the ray before release → up-raycast misses it.
    engine.findObject('target')!.position.set(1000, 1000, 1000);
    engine.input.injectMouseButton(0, false);
    engine.tick(1 / 60);

    expect(clicker.up).toBe(1); // up still goes to the pressed object
    expect(clicker.clicks).toBe(0); // …but no click (released elsewhere)
    engine.dispose();
  });

  it('does not dispatch pointer events in editor mode', () => {
    const r = compileSceneXml(sceneXml);
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine({ editor: true });
    engine.loadScene(bundleScene(r.scene));
    // Clicker is inert in editor mode, so inspect via a non-hook flag instead:
    engine.input.injectMouseButton(0, true);
    engine.tick(1 / 60);
    engine.input.injectMouseButton(0, false);
    engine.tick(1 / 60);
    // No throw, and the component never loaded — nothing dispatched.
    expect(engine.findComponent('target', Clicker)!.down).toBe(0);
    engine.dispose();
  });
});
