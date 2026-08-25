import { Group, Mesh, Object3D, PointLight } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { Component, SceneManager } from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

class Health extends Component {
  max = 100;
  current = 0;
  override awake() { this.current = this.max; }
}

/** Declares the Three.js type it needs, so `addComponent` refuses anything else. */
class Flicker extends Component<PointLight> {
  override update() { this.object3D.intensity = 0.5; }
}

describe('components on a node', () => {
  it('attaches and finds by class, on a node that was never in a scene', () => {
    const loose = new Group();
    const health = loose.addComponent(Health, { max: 250 });

    expect(loose.getComponent(Health)).toBe(health);
    expect(loose.hasComponent(Health)).toBe(true);
    expect(loose.scene).toBe(null);
    // `awake` waits for a scene; the field is still the authored one.
    expect(health.max).toBe(250);
    expect(health.current).toBe(0);
  });

  it('searches children and parents', async () => {
    let root!: Object3D;
    let leaf!: Object3D;
    await SceneManager.load(sceneOf((scene) => {
      root = scene.createObject('root');
      root.addComponent(Health, { max: 10 });
      leaf = new Object3D();
      leaf.addComponent(Health, { max: 20 });
      root.add(leaf);
    }));

    expect(root.getComponentInChildren(Health)?.max).toBe(10);
    expect(root.getComponentsInChildren(Health).map((h) => h.max)).toEqual([10, 20]);
    expect(leaf.getComponentInParent(Health)?.max).toBe(20);
    expect(leaf.getComponentsInParent(Health).map((h) => h.max)).toEqual([20, 10]);
  });

  it('skips inactive branches unless asked for them', async () => {
    let root!: Object3D;
    await SceneManager.load(sceneOf((scene) => {
      root = scene.createObject('root');
      const hidden = new Object3D();
      hidden.addComponent(Health);
      root.add(hidden);
      hidden.setActive(false);
    }));

    expect(root.getComponentsInChildren(Health)).toHaveLength(0);
    expect(root.getComponentsInChildren(Health, true)).toHaveLength(1);
  });

  it('applies one activity rule to every query, parents included', async () => {
    // Children searches always pruned inactive branches; the parent walk used to ignore
    // activity entirely, which was a second rule nobody could see.
    let leaf!: Object3D;
    await SceneManager.load(sceneOf((scene) => {
      const root = scene.createObject('root');
      root.addComponent(Health, { max: 10 });
      leaf = new Object3D();
      root.add(leaf);
      root.setActive(false);
    }));

    expect(leaf.getComponentInParent(Health)).toBe(null);
    expect(leaf.getComponentsInParent(Health)).toHaveLength(0);
    expect(leaf.getComponentInParent(Health, true)?.max).toBe(10);
  });

  it('requireComponent attaches once and returns the same instance after', () => {
    const node = new Group();
    const first = node.requireComponent(Health, { max: 5 });
    const second = node.requireComponent(Health, { max: 999 });
    expect(second).toBe(first);
    expect(first.max).toBe(5);
  });

  it('refuses to attach one component instance to two nodes', () => {
    const a = new Group();
    const b = new Group();
    const health = a.addComponent(Health);
    expect(() => b.addComponent(health)).toThrow(/already attached/);
  });

  it('carries components through clone()', async () => {
    let source!: Object3D;
    await SceneManager.load(sceneOf((scene) => {
      source = scene.createObject('source');
      source.addComponent(Health, { max: 42 });
    }));

    const copy = source.clone();
    const copied = copy.getComponent(Health);
    expect(copied).not.toBe(source.getComponent(Health));
    expect(copied?.max).toBe(42);
    // `clone()` duplicates an object that *exists*, so it carries the state it is in — here
    // the `current` that `awake` computed. A prefab is the other question: build from a
    // definition, and every instance starts from the same known state.
    expect(copied?.current).toBe(42);
  });

  it('drops a component from queries as soon as it is destroyed', async () => {
    let node!: Object3D;
    await SceneManager.load(sceneOf((scene) => {
      node = scene.createObject();
      node.addComponent(Health);
    }));

    const health = node.getComponent(Health)!;
    expect(node.removeComponent(health)).toBe(true);
    new Clock().frame();
    expect(node.getComponent(Health)).toBe(null);
    expect(health.isDestroyed).toBe(true);
  });

  it('types the owning object from the component itself', () => {
    const light = new PointLight();
    light.addComponent(Flicker);

    const mesh = new Mesh();
    // @ts-expect-error — Flicker declares Component<PointLight>; a Mesh is not one.
    mesh.addComponent(Flicker);
  });

  it('refuses an init key the component does not declare', () => {
    const node = new Group();
    // @ts-expect-error — `armour` is not a field of Health.
    node.addComponent(Health, { armour: 3 });
  });
});
