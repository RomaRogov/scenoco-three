import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine, executeInEditor } from '@scenoco-three/core';

class Probe extends Component {
  events: string[] = [];
  override onLoad(): void { this.events.push('onLoad'); }
  override onEnable(): void { this.events.push('onEnable'); }
  override start(): void { this.events.push('start'); }
  override update(dt: number): void { this.events.push(`update:${dt}`); }
  override onDisable(): void { this.events.push('onDisable'); }
  override onDestroy(): void { this.events.push('onDestroy'); }
}

@executeInEditor
class EditorProbe extends Probe {}

describe('component lifecycle', () => {
  it('runs onLoad/onEnable on attach, start on first tick, and applies constructor props before onLoad', () => {
    const engine = new Engine();
    class WithProps extends Probe {
      label = 'default';
      seenAtLoad = '';
      override onLoad(): void { super.onLoad(); this.seenAtLoad = this.label; }
    }
    const c = engine.addComponent(new Object3D(), WithProps, { label: 'custom' });
    expect(c.events).toEqual(['onLoad', 'onEnable']);
    expect(c.seenAtLoad).toBe('custom'); // props applied before onLoad
    engine.tick(0.016);
    expect(c.events).toEqual(['onLoad', 'onEnable', 'start', 'update:0.016']);
  });

  it('skips start/update while disabled and fires onEnable/onDisable on toggle', () => {
    const engine = new Engine();
    const probe = engine.addComponent(new Object3D(), Probe);
    probe.enabled = false;
    engine.tick(0.016);
    expect(probe.events).toEqual(['onLoad', 'onEnable', 'onDisable']);
    probe.enabled = true;
    engine.tick(0.016);
    expect(probe.events).toEqual(['onLoad', 'onEnable', 'onDisable', 'onEnable', 'start', 'update:0.016']);
  });

  it('engine.destroy() recursively tears down a subtree, firing onDestroy, idempotently', () => {
    const engine = new Engine();
    const root = new Object3D();
    const child = new Object3D();
    root.add(child);
    engine.scene.add(root);
    const onRoot = engine.addComponent(root, Probe);
    const onChild = engine.addComponent(child, Probe);

    engine.destroy(root);
    for (const p of [onRoot, onChild]) expect(p.events).toContain('onDestroy');
    expect(engine.scene.children).not.toContain(root);
    expect(() => engine.destroy(root)).not.toThrow(); // idempotent
    engine.tick(0.016);
    expect(onChild.events.filter((e) => e.startsWith('update'))).toHaveLength(0);
  });
});

describe('editor mode (Unity scene-view style)', () => {
  it('leaves normal components inert but runs @executeInEditor components', () => {
    const engine = new Engine({ editor: true });
    const normal = engine.addComponent(new Object3D(), Probe);
    const editorAware = engine.addComponent(new Object3D(), EditorProbe);
    expect(normal.events).toEqual([]); // no hooks for a normal component
    expect(editorAware.events).toEqual(['onLoad', 'onEnable']);
    engine.tick(0.016);
    expect(normal.events).toEqual([]); // still inert
    expect(editorAware.events).toContain('start'); // @executeInEditor ticks
    expect(editorAware.events).toContain('update:0.016');
  });
});
