import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine } from '@scenoco-three/core';

class Probe extends Component {
  events: string[] = [];

  override onLoad(): void {
    this.events.push('onLoad');
  }
  override onEnable(): void {
    this.events.push('onEnable');
  }
  override start(): void {
    this.events.push('start');
  }
  override update(dt: number): void {
    this.events.push(`update:${dt}`);
  }
  override onDisable(): void {
    this.events.push('onDisable');
  }
  override onDestroy(): void {
    this.events.push('onDestroy');
  }
}

describe('component lifecycle (headless engine)', () => {
  it('runs onLoad and onEnable on attach, start on first tick', () => {
    const engine = new Engine();
    const node = new Object3D();
    engine.scene.add(node);

    const probe = engine.addComponent(node, Probe);
    expect(probe.events).toEqual(['onLoad', 'onEnable']);

    engine.tick(0.016);
    engine.tick(0.016);
    expect(probe.events).toEqual([
      'onLoad',
      'onEnable',
      'start',
      'update:0.016',
      'update:0.016',
    ]);
  });

  it('injects node and engine before onLoad', () => {
    const engine = new Engine();
    const node = new Object3D();

    class Inspect extends Component {
      sawNode: unknown;
      sawEngine: unknown;
      override onLoad(): void {
        this.sawNode = this.node;
        this.sawEngine = this.engine;
      }
    }

    const c = engine.addComponent(node, Inspect);
    expect(c.sawNode).toBe(node);
    expect(c.sawEngine).toBe(engine);
  });

  it('applies constructor props before onLoad', () => {
    const engine = new Engine();

    class WithProps extends Component {
      label = 'default';
      seenAtLoad = '';
      override onLoad(): void {
        this.seenAtLoad = this.label;
      }
    }

    const c = engine.addComponent(new Object3D(), WithProps, { label: 'custom' });
    expect(c.seenAtLoad).toBe('custom');
  });

  it('skips start/update while disabled and fires onEnable/onDisable on toggle', () => {
    const engine = new Engine();
    const probe = engine.addComponent(new Object3D(), Probe);

    probe.enabled = false;
    engine.tick(0.016);
    expect(probe.events).toEqual(['onLoad', 'onEnable', 'onDisable']);

    probe.enabled = true;
    engine.tick(0.016);
    expect(probe.events).toEqual([
      'onLoad',
      'onEnable',
      'onDisable',
      'onEnable',
      'start',
      'update:0.016',
    ]);
  });

  it('runs onDisable and onDestroy on removal', () => {
    const engine = new Engine();
    const probe = engine.addComponent(new Object3D(), Probe);
    engine.removeComponent(probe);
    expect(probe.events).toEqual(['onLoad', 'onEnable', 'onDisable', 'onDestroy']);

    // Removing twice is a no-op.
    engine.removeComponent(probe);
    expect(probe.events.filter((e) => e === 'onDestroy')).toHaveLength(1);
  });

  it('does not run onDisable on removal when already disabled', () => {
    const engine = new Engine();
    const probe = engine.addComponent(new Object3D(), Probe);
    probe.enabled = false;
    engine.removeComponent(probe);
    expect(probe.events).toEqual(['onLoad', 'onEnable', 'onDisable', 'onDestroy']);
  });

  it('tracks components per node', () => {
    const engine = new Engine();
    const node = new Object3D();
    const a = engine.addComponent(node, Probe);
    const b = engine.addComponent(node, Probe);
    expect(engine.getComponents(node)).toEqual([a, b]);

    engine.removeComponent(a);
    expect(engine.getComponents(node)).toEqual([b]);
  });

  it('getComponent finds sibling components on the same node (Unity/Cocos style)', () => {
    const engine = new Engine();
    const node = new Object3D();

    class Other extends Component {}

    const probe = engine.addComponent(node, Probe);
    const other = engine.addComponent(node, Other);

    expect(other.getComponent(Probe)).toBe(probe);
    expect(probe.getComponent(Other)).toBe(other);
    expect(probe.getComponent(Probe)).toBe(probe);

    const lonely = engine.addComponent(new Object3D(), Probe);
    expect(lonely.getComponent(Other)).toBeNull();
  });

  it('destroy() removes the component from the engine (Cocos style)', () => {
    const engine = new Engine();
    const node = new Object3D();
    const probe = engine.addComponent(node, Probe);
    probe.destroy();
    expect(probe.events).toEqual(['onLoad', 'onEnable', 'onDisable', 'onDestroy']);
    expect(engine.getComponents(node)).toEqual([]);
  });

  it('destroys every component on dispose', () => {
    const engine = new Engine();
    const a = engine.addComponent(new Object3D(), Probe);
    const b = engine.addComponent(new Object3D(), Probe);
    engine.dispose();
    expect(a.events).toContain('onDestroy');
    expect(b.events).toContain('onDestroy');
    engine.tick(0.016);
    expect(a.events.filter((e) => e.startsWith('update'))).toHaveLength(0);
  });

  it('attaches registered components by name', () => {
    const engine = new Engine();
    const node = new Object3D();
    engine.addComponent(node, 'Rotator', { speed: 2 });
    engine.tick(0.5);
    expect(node.rotation.y).toBeCloseTo(1);
  });

  it('throws a helpful error for unknown component names', () => {
    const engine = new Engine();
    expect(() => engine.addComponent(new Object3D(), 'NoSuchThing')).toThrow(
      /Unknown component "NoSuchThing"/,
    );
  });
});
