import { Group, Mesh, PointLight, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, System } from '@scenoco-three/core';

/**
 * Type-level assertions. Almost nothing here runs — `tsc` is the assertion, and every
 * `@ts-expect-error` fails the build if the thing it guards stops being an error.
 *
 * This is where the API's promises are pinned: that a wrong host is a compile error, that an
 * init object cannot carry a key the class never declared, and that the authoring surface
 * excludes methods, `readonly` fields and getters.
 */

class Health extends Component {
  max = 100;
  private current = 0;
  readonly died = { emit() {} };
  get ratio(): number { return this.current / this.max; }
  applyDamage(amount: number): void { this.current -= amount; }
}

/** Declares the Three.js type it needs, so `addComponent` refuses anything else. */
class Flicker extends Component<PointLight> {
  rate = 3;
  override update(): void {
    // Typed as PointLight, with no cast — this is what the type parameter buys.
    this.object3D.intensity = this.rate;
  }
}

class Physics extends System {
  gravity = new Vector3(0, -9.81, 0);
  private steps = 0;
  step(): void { this.steps++; }
}

/**
 * Never called. `tsc` checks it; running it would execute the very mistakes it guards — the
 * getter case throws on assignment, which is exactly why the type excludes it.
 */
function authoringSurface(): void {
  const node = new Group();
  const scene = new Scene();

  // Accepted: the fields the class declares.
  node.addComponent(Health, { max: 250 });
  scene.addSystem(Physics, { gravity: new Vector3() });

  // @ts-expect-error — `armour` is not a field of Health.
  node.addComponent(Health, { armour: 3 });
  // @ts-expect-error — nor is `drag` a field of Physics.
  scene.addSystem(Physics, { drag: 0.1 });
  // @ts-expect-error — `max` is a number.
  node.addComponent(Health, { max: 'lots' });
  // @ts-expect-error — a method is not a setting.
  node.addComponent(Health, { applyDamage: () => {} });
  // @ts-expect-error — a readonly field is state the component owns.
  node.addComponent(Health, { died: { emit() {} } });
  // @ts-expect-error — a getter has no setter, so assigning one throws at runtime.
  node.addComponent(Health, { ratio: 0.5 });
  // @ts-expect-error — private state is not authorable.
  node.addComponent(Health, { current: 10 });
  // @ts-expect-error — nor is a system's private state.
  scene.addSystem(Physics, { steps: 4 });
  // @ts-expect-error — `enabled` belongs to Component, not to Health's settings.
  node.addComponent(Health, { enabled: false });

  // @ts-expect-error — Flicker declares Component<PointLight>; a Mesh is not one.
  new Mesh().addComponent(Flicker);
  // @ts-expect-error — nor is a plain Group.
  node.addComponent(Flicker);
}

/** Never called, for the same reason. */
function prefabSurface(): void {
  class Crate extends Mesh {
    size = 1;
  }
  // @ts-expect-error — `colour` is not a field of Crate.
  new Group().instantiate(Crate, { colour: 'red' });
}

describe('the authoring surface', () => {
  it('accepts the fields a class declares', () => {
    const node = new Group();
    node.addComponent(Health, { max: 250 });
    new Scene().addSystem(Physics, { gravity: new Vector3(0, -1, 0) });
    expect(node.getComponent(Health)?.max).toBe(250);
  });

  it('rejects everything the guard functions list', () => {
    // The assertions are the `@ts-expect-error` lines above: each one fails the build the
    // moment its target stops being an error. Referencing the functions here keeps them from
    // reading as dead code without calling them.
    expect([authoringSurface, prefabSurface].every((f) => typeof f === 'function')).toBe(true);
  });
});

describe('host types', () => {
  it('lets a component declare the node it needs, and types object3D as it', () => {
    const light = new PointLight();
    const flicker = light.addComponent(Flicker);
    expect(flicker.rate).toBe(3);
    // Rejection of every other node type is guarded in `authoringSurface` above.
  });
});

describe('lookups are typed by the class handed in', () => {
  it('returns the class, not the base', () => {
    const scene = new Scene();
    const node = scene.createObject();
    node.addComponent(Health);
    scene.addSystem(Physics);

    // No cast anywhere: the class *is* the key, which is also why "find all references" works.
    const health: Health | null = node.getComponent(Health);
    const physics: Physics | null = scene.getSystem(Physics);
    const required: Physics = scene.requireSystem(Physics);
    expect([health?.max, physics?.gravity.y, required.gravity.y]).toEqual([100, -9.81, -9.81]);
  });
});

describe('prefabs are structural', () => {
  it('instantiates as the authored root type, with settings and placement in one call', () => {
    class Crate extends Mesh {
      size = 1;
      override onLoad(): void { this.scale.setScalar(this.size); }
    }
    const parent = new Group();
    const crate: Crate = parent.instantiate(Crate, {
      size: 0.5,
      position: new Vector3(0, 1, 0),
      eulerAngles: new Vector3(0, 90, 0),
    });
    // A real Mesh, not a wrapper around one.
    const asMesh: Mesh = crate;
    expect(asMesh).toBeInstanceOf(Mesh);
    expect(crate.scale.x).toBe(0.5);
  });
});

describe('instantiate', () => {
  it('keeps to three overloads, so tsc names the real mistake', async () => {
    // Past three, tsc reports only the last overload's complaint: an `overrides` key a node copy
    // does not take came back as "not assignable to Component", twice in a row for one model.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../packages/core/src/runtime/augment/prefabs.ts', import.meta.url), 'utf8');
    const declared = source.slice(0, source.indexOf('const proto')).match(/^\s{4}instantiate[<(]/gm) ?? [];
    expect(declared).toHaveLength(3);

    const scene = new Scene();
    const copy = scene.instantiate(new Mesh());
    const typed: Mesh = copy;
    // @ts-expect-error — a node copy takes placement only.
    scene.instantiate(new Mesh(), { overrides: {} });
    expect(typed).toBeInstanceOf(Mesh);
  });
});
