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

  it('engine.destroy() defers teardown to end of tick, then tears down the subtree, idempotently', () => {
    const engine = new Engine();
    const root = new Object3D();
    const child = new Object3D();
    root.add(child);
    engine.scene.add(root);
    const onRoot = engine.addComponent(root, Probe);
    const onChild = engine.addComponent(child, Probe);

    engine.destroy(root);
    // Deferred (Unity-style): marked at once but still attached, onDestroy not yet fired.
    for (const p of [onRoot, onChild]) expect(p.events).not.toContain('onDestroy');
    expect(engine.scene.children).toContain(root);

    engine.tick(0.016);
    // Flushed at end of tick: onDestroy fired, detached, and never updated (skipped while pending).
    for (const p of [onRoot, onChild]) {
      expect(p.events).toContain('onDestroy');
      expect(p.events.filter((e) => e.startsWith('update'))).toHaveLength(0);
    }
    expect(engine.scene.children).not.toContain(root);
    expect(() => engine.destroy(root)).not.toThrow(); // idempotent
  });
  it('runs every pending start before any update (Unity Start semantics)', () => {
    const engine = new Engine();
    const log: string[] = [];
    class A extends Component {
      override start(): void { log.push('A.start'); }
      override update(): void { log.push('A.update'); }
    }
    class B extends Component {
      override start(): void { log.push('B.start'); }
      override update(): void { log.push('B.update'); }
    }
    engine.addComponent(new Object3D(), A);
    engine.addComponent(new Object3D(), B);
    engine.tick(0.016);
    expect(log).toEqual(['A.start', 'B.start', 'A.update', 'B.update']);
    engine.dispose();
  });

  it('a component spawned during update runs no phase that tick; start + update come next tick', () => {
    const engine = new Engine();
    class Spawner extends Component {
      spawned?: Probe;
      override update(): void {
        this.spawned ??= this.engine.addComponent(new Object3D(), Probe);
      }
    }
    const spawner = engine.addComponent(new Object3D(), Spawner);
    engine.tick(0.016);
    const spawned = spawner.spawned!;
    expect(spawned.events).toEqual(['onLoad', 'onEnable']); // loaded synchronously, but silent this tick
    engine.tick(0.016);
    expect(spawned.events).toEqual(['onLoad', 'onEnable', 'start', 'update:0.016']);
    engine.dispose();
  });

  it('a component destroyed during another component update is skipped that same tick', () => {
    const engine = new Engine();
    // A killer that destroys the victim on its own first update. Execution order is
    // insertion order, so inserting the killer first makes it run before the victim.
    class Killer extends Component {
      target!: Probe;
      override update(): void { this.engine.destroyComponent(this.target); }
    }
    const killer = engine.addComponent(new Object3D(), Killer);
    const victim = engine.addComponent(new Object3D(), Probe);
    killer.target = victim;

    engine.tick(0.016);
    // Victim was marked before its turn in the update loop → never updated, and torn down at flush.
    expect(victim.events.filter((e) => e.startsWith('update'))).toHaveLength(0);
    expect(victim.events).toContain('onDestroy');
    engine.dispose();
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
