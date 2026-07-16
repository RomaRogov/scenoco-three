import { BoxGeometry, Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine, System, system } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

describe('engine: deterministic RNG', () => {
  it('same seed yields the same stream; different seeds diverge', () => {
    const a = new Engine({ seed: 42 });
    const b = new Engine({ seed: 42 });
    const seqA = Array.from({ length: 5 }, () => a.random());
    const seqB = Array.from({ length: 5 }, () => b.random());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Engine({ seed: 43 }).random()).not.toBe(seqA[0]);
    a.dispose();
    b.dispose();
  });
});

describe('engine: time & timeScale', () => {
  it('advances scaled/unscaled clocks and frame count; timeScale 0 freezes sim time', () => {
    const e = new Engine();
    e.timeScale = 0.5;
    e.tick(0.1);
    expect(e.deltaTime).toBeCloseTo(0.05);
    expect(e.time).toBeCloseTo(0.05);
    expect(e.unscaledTime).toBeCloseTo(0.1);
    expect(e.frameCount).toBe(1);

    const t = e.time;
    e.timeScale = 0;
    e.tick(0.1);
    expect(e.deltaTime).toBe(0);
    expect(e.time).toBeCloseTo(t); // frozen
    expect(e.unscaledTime).toBeCloseTo(0.2); // still advancing
    e.dispose();
  });
});

/** Records every phase call with a global order counter, so we can assert ordering. */
let counter = 0;
class PhaseProbe extends Component {
  fixed: number[] = [];
  updates: number[] = [];
  lates: number[] = [];
  override fixedUpdate(): void {
    this.fixed.push(counter++);
  }
  override update(): void {
    this.updates.push(counter++);
  }
  override lateUpdate(): void {
    this.lates.push(counter++);
  }
}

describe('engine: fixed-step lifecycle phases', () => {
  it('drains the fixed-step accumulator at the configured rate and caps a long pause', () => {
    const engine = new Engine({ fixedTimeStep: 0.02 });
    const probe = engine.addComponent(new Object3D(), PhaseProbe);
    counter = 0;
    engine.tick(0.05); // 0.05 / 0.02 = 2 full fixed steps, 0.01 left over
    expect(probe.fixed.length).toBe(2);
    expect(probe.updates.length).toBe(1); // update is once per tick regardless
    engine.tick(0.01); // 0.01 + 0.01 leftover = 0.02 → one more fixed step
    expect(probe.fixed.length).toBe(3);
    engine.tick(10); // would be ~500 steps uncapped → capped
    expect(probe.fixed.length).toBeLessThanOrEqual(8);
    engine.dispose();
  });

  it('orders phases: all fixedUpdate(s) → update → lateUpdate', () => {
    const engine = new Engine({ fixedTimeStep: 0.02 });
    const probe = engine.addComponent(new Object3D(), PhaseProbe);
    counter = 0;
    engine.tick(0.02); // exactly one fixed step
    expect(probe.fixed[0]).toBeLessThan(probe.updates[0]!);
    expect(probe.updates[0]).toBeLessThan(probe.lates[0]!);
    engine.dispose();
  });
});

describe('engine: subsystems', () => {
  class FakePhysics extends System {
    attached = false;
    fixedSteps = 0;
    steps = 0;
    detached = false;
    override onAttach(): void {
      this.attached = this.engine !== undefined; // engine is injected before onAttach
    }
    override fixedStep(): void {
      this.fixedSteps++;
    }
    override step(): void {
      this.steps++;
    }
    override onDetach(): void {
      this.detached = true;
    }
  }

  it('steps systems before component update, so gameplay reads this frame\'s system output', () => {
    const engine = new Engine();
    let stepped = 0;
    class Sys extends System {
      override step(): void { stepped++; }
    }
    class Reader extends Component {
      seen = -1;
      override update(): void { this.seen = stepped; }
    }
    engine.addSystem(new Sys());
    const reader = engine.addComponent(new Object3D(), Reader);
    engine.tick(1 / 60);
    expect(reader.seen).toBe(1); // the system had already stepped when update ran
    engine.dispose();
  });

  it('injects engine + onAttach, steps in both phases, and is retrievable by type', () => {
    const engine = new Engine({ fixedTimeStep: 0.02 });
    const sys = engine.addSystem(new FakePhysics());
    expect(sys.attached).toBe(true);
    expect(sys.engine).toBe(engine);
    expect(engine.getSystem(FakePhysics)).toBe(sys);
    engine.tick(0.04); // 2 fixed steps, 1 variable step
    expect(sys.fixedSteps).toBe(2);
    expect(sys.steps).toBe(1);
    engine.dispose();
    expect(sys.detached).toBe(true);
    expect(engine.getSystem(FakePhysics)).toBeUndefined();
  });
});

describe('engine: deferred scene swap and destruction flush', () => {
  it('loadScene from inside update defers the swap to end of tick; the old scene finishes the frame', () => {
    const r = compileSceneXml('<Scene><Mesh id="newRoot"><BoxGeometry /></Mesh></Scene>');
    if (!r.ok) throw new Error('compile failed');
    const bundle = bundleScene(r.scene);
    const engine = new Engine();
    class Swapper extends Component {
      override update(): void { this.engine.loadScene(bundle); }
    }
    class After extends Component {
      sawNewSceneMidTick = false;
      updates = 0;
      override update(): void {
        this.updates++;
        this.sawNewSceneMidTick = this.engine.findObject('newRoot') !== undefined;
      }
    }
    // Insertion order: Swapper requests the swap before After runs.
    engine.addComponent(new Object3D(), Swapper);
    const after = engine.addComponent(new Object3D(), After);
    engine.tick(1 / 60);
    expect(after.updates).toBe(1); // the rest of the tick still ran on the old scene
    expect(after.sawNewSceneMidTick).toBe(false); // swap not applied mid-tick…
    expect(engine.findObject('newRoot')).toBeDefined(); // …but live once the tick ends
    engine.dispose();
  });

  it('destroying a parent and its child in the same tick disposes the child geometry exactly once', () => {
    const engine = new Engine();
    const parent = new Mesh(new BoxGeometry());
    const child = new Mesh(new BoxGeometry());
    parent.add(child);
    engine.scene.add(parent);
    let disposals = 0;
    child.geometry.addEventListener('dispose', () => disposals++);
    engine.destroy(parent);
    engine.destroy(child);
    engine.tick(1 / 60);
    expect(disposals).toBe(1);
    engine.dispose();
  });
});

// CORE-IMPROVEMENTS #1: a @system must start when its component type first
// appears at RUNTIME (spawned prefab / addComponent), not only if present at
// scene load — otherwise a spawn-only game gets silently dead physics.
class Marker extends Component {}

@system(Marker)
class MarkerSystem extends System<Marker> {
  seen = 0;
  detached = false;
  override step(): void {
    this.seen = this.components.length;
  }
  override onDetach(): void {
    this.detached = true;
  }
}

describe('engine: systems auto-attach at runtime (CORE-IMPROVEMENTS #1)', () => {
  it('starts a @system when its component first appears via addComponent, and seeds the query', () => {
    const engine = new Engine({ fixedTimeStep: 0.02 });
    expect(engine.getSystem(MarkerSystem)).toBeUndefined(); // none at load → not running

    const node = new Object3D();
    engine.scene.add(node);
    engine.addComponent(node, Marker); // appears at runtime → auto-attaches
    const sys = engine.getSystem(MarkerSystem);
    expect(sys).toBeDefined();

    engine.tick(0.02);
    expect(sys!.seen).toBe(1); // the live query was seeded with the new component

    engine.disposeScene(); // scene-scoped: torn down on unload
    expect(engine.getSystem(MarkerSystem)).toBeUndefined();
    expect(sys!.detached).toBe(true);
    engine.dispose();
  });
});
