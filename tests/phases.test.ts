import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine, System } from '@scenoco-three/core';

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

describe('lifecycle phases (goal 5 groundwork)', () => {
  it('drains the fixed-step accumulator at the configured rate', () => {
    const engine = new Engine({ fixedTimeStep: 0.02 });
    const probe = engine.addComponent(new Object3D(), PhaseProbe);
    counter = 0;
    engine.tick(0.05); // 0.05 / 0.02 = 2 full fixed steps, 0.01 left over
    expect(probe.fixed.length).toBe(2);
    expect(probe.updates.length).toBe(1); // update is once per tick regardless
    engine.tick(0.01); // 0.01 + 0.01 leftover = 0.02 → one more fixed step
    expect(probe.fixed.length).toBe(3);
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

  it('caps fixed substeps so a long pause does not spiral', () => {
    const engine = new Engine({ fixedTimeStep: 0.016 });
    const probe = engine.addComponent(new Object3D(), PhaseProbe);
    engine.tick(10); // would be ~625 steps uncapped
    expect(probe.fixed.length).toBeLessThanOrEqual(5);
    engine.dispose();
  });
});

describe('engine subsystems (goal 5 groundwork)', () => {
  class FakePhysics extends System {
    attached = false;
    fixedSteps = 0;
    steps = 0;
    detached = false;
    gravity = -9.81;
    override onAttach(): void {
      // engine is injected before onAttach
      this.attached = this.engine !== undefined;
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

  it('a component can reach a subsystem through the engine', () => {
    const engine = new Engine();
    const sys = engine.addSystem(new FakePhysics());
    class Reader extends Component {
      seen?: number;
      override start(): void {
        this.seen = this.engine.getSystem(FakePhysics)?.gravity;
      }
    }
    const r = engine.addComponent(new Object3D(), Reader);
    engine.tick(0.016);
    expect(r.seen).toBe(sys.gravity);
    engine.dispose();
  });
});
