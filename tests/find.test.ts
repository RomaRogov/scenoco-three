import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine, type Bundle } from '@scenoco-three/core';
import { Oscillator } from '../playground/components/Oscillator.js';
import { Rotator } from '../playground/components/Rotator.js';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

function toBundle(xml: string): Bundle {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return bundleScene(r.scene);
}

const SCENE = `<Scene>
  <Mesh id="hero" position="0 1 0">
    <BoxGeometry />
    <Components>
      <Rotator speed="2" />
      <Oscillator id="bob" amplitude="0.5" />
    </Components>
  </Mesh>
</Scene>`;

describe('engine.findObject / findComponent', () => {
  it('finds an Object3D by its id', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(SCENE));
    const hero = engine.findObject('hero');
    expect(hero).toBeDefined();
    expect(hero!.position.y).toBe(1);
    expect(engine.findObject('nope')).toBeUndefined();
  });

  it('finds a component by its own id', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(SCENE));
    const bob = engine.findComponent('bob');
    expect(bob).toBeInstanceOf(Oscillator);
    expect(engine.findComponent('bob', Oscillator)).toBe(bob);
    expect(engine.findComponent('bob', Rotator)).toBeUndefined(); // type mismatch
  });

  it('falls back to node id → component of a type (mirrors #id resolution)', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(SCENE));
    // "hero" is a node id; ask for the Rotator on it.
    expect(engine.findComponent('hero', Rotator)).toBeInstanceOf(Rotator);
  });

  it('stops finding a component after it is removed', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(SCENE));
    const bob = engine.findComponent('bob', Oscillator)!;
    bob.destroy();
    expect(engine.findComponent('bob')).toBeUndefined();
  });

  it('finds objects inside dynamically spawned prefab subtrees', () => {
    const engine = new Engine();
    const r = compileSceneXml(`<Scene><Group id="g"><Mesh id="inner"><BoxGeometry /></Mesh></Group></Scene>`);
    if (!r.ok) throw new Error('compile failed');
    const instance = engine.instantiate(bundleScene(r.scene));
    void instance;
    expect(engine.findObject('inner')).toBeDefined();
  });

  it('ignores ids on manually attached components (they have none)', () => {
    const engine = new Engine();
    const node = new Object3D();
    engine.scene.add(node);
    engine.addComponent(node, Oscillator);
    expect(engine.findComponent('anything')).toBeUndefined();
  });
});
