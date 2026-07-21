import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { Component, Engine, component, type Bundle } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Oscillator } from '../fixtures/components/Oscillator.js';
import { Rotator } from '../fixtures/components/Rotator.js';

function toBundle(xml: string): Bundle {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return bundleScene(r.scene);
}

const NESTED = `<Scene>
  <Group id="root">
    <Components><Rotator id="rootRot" speed="1" /></Components>
    <Mesh id="hero" position="0 1 0"><Attachments><BoxGeometry /></Attachments><Components>
      <Rotator speed="2" /><Oscillator id="bob" amplitude="0.5" />
    </Components></Mesh>
    <Mesh id="b"><Attachments><BoxGeometry /></Attachments><Components><Oscillator id="osc" amplitude="0.5" /></Components></Mesh>
  </Group>
</Scene>`;

describe('engine.findObject / findComponent', () => {
  it('resolves objects and components by id (with type filter + node-id fallback), and forgets them after removal', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(NESTED));
    expect(engine.findObject('hero')!.position.y).toBe(1);
    expect(engine.findObject('nope')).toBeUndefined();

    const bob = engine.findComponent('bob', Oscillator)!;
    expect(bob).toBeInstanceOf(Oscillator);
    expect(engine.findComponent('bob', Rotator)).toBeUndefined(); // type mismatch
    expect(engine.findComponent('hero', Rotator)).toBeInstanceOf(Rotator); // node id → its Rotator

    bob.destroy();
    expect(engine.findComponent('bob')).toBeUndefined();
    engine.dispose();
  });

  it('answers type-only queries: getComponentsOfType + getComponentsInChildren (Unity style)', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(NESTED));
    expect(engine.getComponentsOfType(Rotator).length).toBe(2);
    const root = engine.findComponent('rootRot', Rotator)!;
    expect(root.node.getComponentsInChildren(Rotator).length).toBe(2); // self + child Rotator
    expect(root.node.getComponentInChildren(Oscillator)).toBe(engine.findComponent('bob', Oscillator));
    engine.dispose();
    expect(engine.getComponentsOfType(Rotator)).toEqual([]); // empty after dispose
  });
});

describe('node component API (Object3D augmentation)', () => {
  it('queries and mutates components through the host node (Unity/Cocos style)', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(NESTED));

    const root = engine.findObject('root')!;
    expect(root.getComponent(Rotator)).toBe(engine.findComponent('rootRot', Rotator));
    expect(root.getComponentsInChildren(Rotator).length).toBe(2); // self + child Rotator
    expect(root.getComponentInChildren(Oscillator)).toBe(engine.findComponent('bob', Oscillator));
    expect(root.getComponents()).toContain(engine.findComponent('rootRot', Rotator));

    // addComponent on the node attaches to that node and runs onLoad.
    const added = root.addComponent(Oscillator);
    expect(added).toBeInstanceOf(Oscillator);
    expect(root.getComponent(Oscillator)).toBe(added);

    // removeComponent is deferred — the component survives until the tick flushes.
    root.removeComponent(added);
    expect(added._destroyed).toBe(true);
    engine.tick(1 / 60);
    expect(root.getComponent(Oscillator)).toBeNull();

    engine.dispose();
  });

  it('throws a clear error (never silent null) on a node outside any engine', () => {
    const loose = new Object3D();
    expect(loose.isSceneAttached).toBe(false);
    expect(() => loose.getComponent(Rotator)).toThrow(/engine's scene/);
    expect(() => loose.getComponents()).toThrow(/engine's scene/);
    expect(() => loose.getComponentsInChildren(Rotator)).toThrow(/engine's scene/);
    expect(() => loose.addComponent(Rotator)).toThrow(/engine's scene/);
  });

  it('resolves the engine through the scene tree — hand-built nodes use the node API directly', () => {
    const engine = new Engine();
    const cube = new Object3D();
    engine.scene.add(cube); // hand-built, never indexed
    expect(cube.isSceneAttached).toBe(true);
    const rot = cube.addComponent(Rotator, { speed: 3 }); // works without engine.addComponent
    expect(cube.getComponent(Rotator)).toBe(rot);
    engine.dispose();
  });
});

const log: string[] = [];
@component({ name: 'OrderLast', order: 10, description: 'runs last' })
class OrderLast extends Component {
  override onLoad(): void { log.push('load:last'); }
  override update(): void { log.push('update:last'); }
}
@component({ name: 'OrderFirst', order: -10, description: 'runs first' })
class OrderFirst extends Component {
  override onLoad(): void { log.push('load:first'); }
  override update(): void { log.push('update:first'); }
}
@component({ name: 'OrderMid', description: 'runs in the middle' })
class OrderMid extends Component {
  override update(): void { log.push('update:mid'); }
}

describe('execution order (@component order)', () => {
  it('runs onLoad and update in ascending order regardless of declaration order', () => {
    log.length = 0;
    // Declared Last, First, Mid — execution must be First(-10), Mid(0), Last(10).
    const engine = new Engine();
    engine.loadScene(toBundle('<Scene><Group><Components><OrderLast /><OrderFirst /><OrderMid /></Components></Group></Scene>'));
    engine.tick(1 / 60);
    expect(log).toEqual(['load:first', 'load:last', 'update:first', 'update:mid', 'update:last']);
    engine.dispose();
  });
});
