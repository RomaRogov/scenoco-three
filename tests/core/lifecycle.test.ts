import { Object3D, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, SceneManager, Time } from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

/** Records every hook it receives, so a test can assert on the whole ordering at once. */
class Tracer extends Component {
  label = 'tracer';
  log: string[] = [];
  override awake() { this.log.push('awake'); }
  override onEnable() { this.log.push('onEnable'); }
  override start() { this.log.push('start'); }
  override update() { this.log.push('update'); }
  override lateUpdate() { this.log.push('lateUpdate'); }
  override onDisable() { this.log.push('onDisable'); }
  override onDestroy() { this.log.push('onDestroy'); }
}

describe('component lifecycle', () => {
  it('wakes and enables during load, and starts on the first tick', async () => {
    let tracer!: Tracer;
    await SceneManager.load(sceneOf((scene) => {
      tracer = scene.createObject('subject').addComponent(Tracer);
    }));

    // `start` waits for a tick, as it does in Unity — `awake` may still be spawning siblings.
    expect(tracer.log).toEqual(['awake', 'onEnable']);

    new Clock().frame();
    expect(tracer.log).toEqual(['awake', 'onEnable', 'start', 'update', 'lateUpdate']);
  });

  it('runs every awake in a subtree before any start in it', async () => {
    const order: string[] = [];
    class Noisy extends Component {
      label = '';
      override awake() { order.push(`awake:${this.label}`); }
      override start() { order.push(`start:${this.label}`); }
    }
    await SceneManager.load(sceneOf((scene) => {
      const parent = scene.createObject('parent');
      const child = new Object3D();
      child.addComponent(Noisy, { label: 'child' });
      parent.addComponent(Noisy, { label: 'parent' });
      parent.add(child);
    }));
    new Clock().frame();

    expect(order.slice(0, 2).sort()).toEqual(['awake:child', 'awake:parent']);
    expect(order.slice(2).sort()).toEqual(['start:child', 'start:parent']);
  });

  it('applies init before awake, so a component never wakes on a stale default', async () => {
    let seen = '';
    class Reader extends Component {
      label = 'default';
      override awake() { seen = this.label; }
    }
    await SceneManager.load(sceneOf((scene) => {
      scene.createObject().addComponent(Reader, { label: 'authored' });
    }));
    expect(seen).toBe('authored');
  });

  it('fires onDisable/onEnable when `enabled` is toggled, without a second awake', async () => {
    let tracer!: Tracer;
    await SceneManager.load(sceneOf((scene) => {
      tracer = scene.createObject().addComponent(Tracer);
    }));
    const clock = new Clock();
    clock.frame();
    tracer.log.length = 0;

    tracer.enabled = false;
    clock.frame();
    expect(tracer.log).toEqual(['onDisable']);

    tracer.enabled = true;
    clock.frame();
    expect(tracer.log).toEqual(['onDisable', 'onEnable', 'update', 'lateUpdate']);
  });

  it('stops ticking a subtree deactivated with setActive, and resumes it', async () => {
    let tracer!: Tracer;
    let root!: Object3D;
    await SceneManager.load(sceneOf((scene) => {
      root = scene.createObject('root');
      const child = new Object3D();
      tracer = child.addComponent(Tracer);
      root.add(child);
    }));
    const clock = new Clock();
    clock.frame();

    root.setActive(false);
    expect(tracer.isActiveAndEnabled).toBe(false);
    tracer.log.length = 0;
    clock.frame();
    expect(tracer.log).toEqual([]);

    root.setActive(true);
    clock.frame();
    expect(tracer.log).toEqual(['onEnable', 'update', 'lateUpdate']);
  });

  it('defers destruction to the end of the frame', async () => {
    const order: string[] = [];
    class Suicidal extends Component {
      override update() {
        order.push('update');
        this.object3D.destroy();
      }
      override onDestroy() { order.push('onDestroy'); }
    }
    class Witness extends Component {
      override lateUpdate() { order.push('lateUpdate'); }
    }
    await SceneManager.load(sceneOf((scene) => {
      scene.createObject().addComponent(Suicidal);
      scene.createObject().addComponent(Witness);
    }));
    new Clock().frame();

    // The whole frame completes before anything is torn down.
    expect(order).toEqual(['update', 'lateUpdate', 'onDestroy']);
  });

  it('tears a subtree down depth-first and detaches it from the graph', async () => {
    const destroyed: string[] = [];
    class Marker extends Component {
      label = '';
      override onDestroy() { destroyed.push(this.label); }
    }
    let root!: Object3D;
    let scene!: Scene;
    await SceneManager.load(sceneOf((s) => {
      scene = s;
      root = s.createObject('root');
      root.addComponent(Marker, { label: 'root' });
      const child = new Object3D();
      child.addComponent(Marker, { label: 'child' });
      root.add(child);
    }));

    root.destroy();
    new Clock().frame();

    expect(destroyed).toEqual(['child', 'root']);
    expect(root.parent).toBe(null);
    expect(scene.componentCount).toBe(0);
  });

  it('takes fixed steps at the fixed rate regardless of frame length', async () => {
    class Stepper extends Component {
      steps = 0;
      seen: number[] = [];
      override fixedUpdate(dt: number) { this.steps++; this.seen.push(dt); }
    }
    Time.fixedDeltaTime = 0.02;
    let stepper!: Stepper;
    await SceneManager.load(sceneOf((scene) => {
      stepper = scene.createObject().addComponent(Stepper);
    }));

    const clock = new Clock();
    // The first frame has no previous timestamp, so it gets a nominal 1/60 delta rather than
    // the one asked for — not enough for a step, and banked into the accumulator.
    clock.frame(0.02);
    expect(stepper.steps).toBe(0);
    clock.frame(0.1);   // 0.1 + the banked 1/60 → five whole steps
    expect(stepper.steps).toBe(5);
    // `fixedUpdate` always sees exactly `fixedDeltaTime`, never the frame's delta.
    expect(new Set(stepper.seen)).toEqual(new Set([0.02]));
  });

  it('keeps a throwing hook from taking the frame down', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Broken extends Component {
      override update(): void { throw new Error('boom'); }
    }
    let survivor!: Tracer;
    await SceneManager.load(sceneOf((scene) => {
      scene.createObject().addComponent(Broken);
      survivor = scene.createObject().addComponent(Tracer);
    }));

    expect(() => new Clock().frame()).not.toThrow();
    expect(survivor.log).toContain('update');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
