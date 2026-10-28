import { afterEach, describe, expect, it } from 'vitest';
import { Group, Object3D, Scene } from 'three';
import {
  Behaviour,
  Event,
  Runtime,
  Time,
  WaitForSeconds,
  WaitForSecondsRealtime,
  WaitUntil,
  destroy,
  findObjectOfType,
} from '@scenoco-three/core';

const runtimes: Runtime[] = [];
function world() {
  const scene = new Scene();
  const runtime = new Runtime(scene);
  runtimes.push(runtime);
  return { scene, runtime };
}
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));

class Log extends Behaviour {
  log: string[] = [];
  override awake() { this.log.push('awake'); }
  override onEnable() { this.log.push('onEnable'); }
  override start() { this.log.push('start'); }
  override update() { this.log.push('update'); }
  override lateUpdate() { this.log.push('lateUpdate'); }
  override onDisable() { this.log.push('onDisable'); }
  override onDestroy() { this.log.push('onDestroy'); }
}

describe('lifecycle', () => {
  it('runs Unity order: awake and onEnable on attach, start before the first update', () => {
    const { scene, runtime } = world();
    const node = new Object3D();
    scene.add(node);
    const b = node.addComponent(Log);
    expect(b.log).toEqual(['awake', 'onEnable']);
    runtime.update(1 / 60);
    runtime.update(1 / 60);
    expect(b.log).toEqual(['awake', 'onEnable', 'start', 'update', 'lateUpdate', 'update', 'lateUpdate']);
  });

  it('calls onValidate after the editor changes a field, as Unity does — and lets the change through when it throws', async () => {
    const { setField } = await import('../../packages/core/src/editor/index.js');
    class Placer extends Behaviour {
      t = 0;
      placedAt = -1;
      override onValidate() {
        this.placedAt = this.t;
        if (this.t > 1) throw new Error('off the path');
      }
    }
    const { scene } = world();
    const node = new Object3D();
    scene.add(node);
    const placer = node.addComponent(Placer);
    setField(placer, 't', 0.4);
    expect(placer.placedAt).toBe(0.4);
    const quiet = console.error;
    console.error = () => {};
    setField(placer, 't', 2);
    console.error = quiet;
    expect(placer.t).toBe(2);
  });

  it('holds behaviours short of a hook when told to — the editor\'s reset — and goes on from there', () => {
    const { scene, runtime } = world();
    runtime.reach = 'none';
    const node = new Object3D();
    scene.add(node);
    const b = node.addComponent(Log);
    runtime.update(1 / 60);
    expect(b.log).toEqual([]);
    runtime.reach = 'start';
    runtime.update(1 / 60);
    expect(b.log).toEqual(['awake', 'onEnable', 'start']);
    runtime.reach = 'frame';
    runtime.update(1 / 60);
    expect(b.log).toEqual(['awake', 'onEnable', 'start', 'update', 'lateUpdate']);
  });

  it('gives one made mid-frame no update until its start, next frame', () => {
    const { scene, runtime } = world();
    let made: Log | null = null;
    class Maker extends Behaviour {
      override update() {
        if (made) return;
        const node = new Object3D();
        scene.add(node);
        made = node.addComponent(Log);
      }
    }
    const host = new Object3D();
    scene.add(host);
    host.addComponent(Maker);
    runtime.update(1 / 60); // Maker starts, then makes a Log during update
    expect(made!.log).toEqual(['awake', 'onEnable']);
    runtime.update(1 / 60);
    expect(made!.log).toEqual(['awake', 'onEnable', 'start', 'update', 'lateUpdate']);
  });

  it('stays dormant off-scene, and wakes when the node joins the scene by any route', () => {
    const { scene, runtime } = world();
    const node = new Object3D();
    const b = node.addComponent(Log);
    expect(b.log).toEqual([]);
    (scene.children as Object3D[]).push(node); // no add(), no event — the per-frame check finds it
    node.parent = scene;
    runtime.update(1 / 60);
    expect(b.log.slice(0, 3)).toEqual(['awake', 'onEnable', 'start']);
  });

  it('survives three.js attach() between parents without onDisable', () => {
    const { scene, runtime } = world();
    const a = new Group();
    const c = new Group();
    const node = new Object3D();
    scene.add(a, c);
    a.add(node);
    const b = node.addComponent(Log);
    runtime.update(1 / 60);
    c.attach(node);
    runtime.update(1 / 60);
    expect(b.log).not.toContain('onDisable');
    expect(b.log.filter((e) => e === 'update')).toHaveLength(2);
  });

  it('disables on leaving the scene and re-enables on return, with no second awake or start', () => {
    const { scene, runtime } = world();
    const node = new Object3D();
    scene.add(node);
    const b = node.addComponent(Log);
    runtime.update(1 / 60);
    scene.remove(node);
    runtime.update(1 / 60);
    scene.add(node);
    runtime.update(1 / 60);
    expect(b.log.filter((e) => e === 'awake' || e === 'start')).toEqual(['awake', 'start']);
    expect(b.log.filter((e) => e === 'onDisable' || e === 'onEnable')).toEqual(['onEnable', 'onDisable', 'onEnable']);
  });

  it('enabled = false stops updates and fires onDisable', () => {
    const { scene, runtime } = world();
    const node = new Object3D();
    scene.add(node);
    const b = node.addComponent(Log);
    runtime.update(1 / 60);
    b.enabled = false;
    runtime.update(1 / 60);
    expect(b.log.at(-1)).toBe('onDisable');
  });
});

describe('destroy', () => {
  it('stops hooks at once, runs onDestroy at the end of the frame, removes the node', () => {
    const { scene, runtime } = world();
    const node = new Object3D();
    scene.add(node);
    const b = node.addComponent(Log);
    runtime.update(1 / 60);
    destroy(node);
    expect(node.parent).toBe(scene);
    runtime.update(1 / 60);
    expect(b.log.slice(-2)).toEqual(['onDisable', 'onDestroy']);
    expect(b.log.filter((e) => e === 'update')).toHaveLength(1);
    expect(node.parent).toBeNull();
    expect(b.isDestroyed).toBe(true);
  });

  it('drops listen() subscriptions with the behaviour', () => {
    const { scene, runtime } = world();
    const ping = new Event<[]>();
    class Listener extends Behaviour {
      heard = 0;
      override awake() { this.listen(ping, () => this.heard++); }
    }
    const node = new Object3D();
    scene.add(node);
    node.addComponent(Listener);
    expect(ping.listenerCount).toBe(1);
    destroy(node);
    runtime.update(1 / 60);
    expect(ping.listenerCount).toBe(0);
  });
});

describe('lookups and coroutines', () => {
  it('finds by class, and refuses a string with the right spelling', () => {
    const { scene } = world();
    const node = new Object3D();
    scene.add(node);
    const b = node.addComponent(Log);
    expect(node.getComponent(Log)).toBe(b);
    expect(scene.getComponentInChildren(Log)).toBe(b);
    expect(findObjectOfType(Log)).toBe(b);
    expect(() => node.getComponent('Log' as never)).toThrow(/getComponent\(Log\)/);
  });

  it('waits seconds in a coroutine and stops it on destroy', () => {
    const { scene, runtime } = world();
    class Ticker extends Behaviour {
      ticks = 0;
      override start() {
        const self = this;
        this.startCoroutine((function* () {
          while (true) { self.ticks++; yield new WaitForSeconds(0.5); }
        })());
      }
    }
    const node = new Object3D();
    scene.add(node);
    const t = node.addComponent(Ticker);
    // Ticks on its first frame, then on the first frame each half second has passed: 1, 31, 61.
    for (let i = 0; i < 61; i++) runtime.update(1 / 60);
    expect(t.ticks).toBe(3);
    destroy(node);
    for (let i = 0; i < 60; i++) runtime.update(1 / 60);
    expect(t.ticks).toBe(3);
  });

  it('waits the Unity ways: a condition, another coroutine, real time; and refuses a bare number', () => {
    const { scene, runtime } = world();
    const log: string[] = [];
    let open = false;
    class Door extends Behaviour {
      override start() {
        this.startCoroutine(this.run());
      }
      *run() {
        yield new WaitUntil(() => open);
        log.push('opened');
        yield this.startCoroutine(this.creak());
        log.push('after creak');
      }
      *creak() {
        yield new WaitForSecondsRealtime(0.1);
        log.push('creaked');
      }
    }
    const node = new Object3D();
    scene.add(node);
    node.addComponent(Door);
    for (let i = 0; i < 5; i++) runtime.update(1 / 60);
    expect(log).toEqual([]);
    open = true;
    Time.timeScale = 0; // real time still passes
    for (let i = 0; i < 12; i++) runtime.update(1 / 60);
    expect(log).toEqual(['opened', 'creaked', 'after creak']);

    class Sloppy extends Behaviour {
      override start() {
        this.startCoroutine((function* () { yield 0.5 as never; })());
      }
    }
    node.addComponent(Sloppy);
    expect(() => runtime.update(1 / 60)).toThrow(/yield new WaitForSeconds\(0\.5\)/);
  });
});

describe('Time', () => {
  it('pauses at timeScale 0: update runs with deltaTime 0, fixedUpdate and WaitForSeconds stop', () => {
    const { scene, runtime } = world();
    class Clock extends Behaviour {
      updates = 0;
      fixed = 0;
      waited = 0;
      lastDelta = -1;
      override start() {
        const self = this;
        this.startCoroutine((function* () { while (true) { yield new WaitForSeconds(0.1); self.waited++; } })());
      }
      override update(dt: number) { this.updates++; this.lastDelta = dt; }
      override fixedUpdate() { this.fixed++; }
    }
    const node = new Object3D();
    scene.add(node);
    const clock = node.addComponent(Clock);
    for (let i = 0; i < 30; i++) runtime.update(1 / 60);
    const before = { fixed: clock.fixed, waited: clock.waited, time: Time.time };
    expect(before.fixed).toBeGreaterThan(20);
    expect(before.waited).toBeGreaterThan(3);

    Time.timeScale = 0;
    for (let i = 0; i < 30; i++) runtime.update(1 / 60);
    expect(clock.updates).toBe(60);
    expect(clock.lastDelta).toBe(0);
    expect(Time.deltaTime).toBe(0);
    expect(Time.unscaledDeltaTime).toBeCloseTo(1 / 60);
    expect(clock.fixed).toBe(before.fixed);
    expect(clock.waited).toBe(before.waited);
    expect(Time.time).toBe(before.time);
    expect(Time.unscaledTime).toBeCloseTo(1);

    Time.timeScale = 0.5; // slow motion: half the fixed steps
    for (let i = 0; i < 30; i++) runtime.update(1 / 60);
    expect(clock.fixed - before.fixed).toBeCloseTo(12, -1);
  });

  it('applies settings the three.js way: arrays into vectors, strings into colours', async () => {
    const { Vector3, Color } = await import('three');
    class S extends Behaviour {
      at = new Vector3();
      tint = new Color();
    }
    const node = new Object3D();
    const s = node.addComponent(S, { at: [1, 2, 3], tint: '#ff0000' });
    expect(s.at.toArray()).toEqual([1, 2, 3]);
    expect(s.tint.getHexString()).toBe('ff0000');
  });
});

describe('destroying a node', () => {
  it('tears down every behaviour on it, not every other one', () => {
    const scene = new Scene();
    const runtime = new Runtime(scene);
    runtimes.push(runtime);
    const node = new Object3D();
    scene.add(node);
    const logs = [node.addComponent(Log), node.addComponent(Log), node.addComponent(Log)];
    runtime.update(1 / 60);
    destroy(node);
    runtime.update(1 / 60);
    expect(logs.map((b) => b.log.includes('onDestroy'))).toEqual([true, true, true]);
  });
});
