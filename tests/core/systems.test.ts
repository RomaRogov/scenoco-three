import { Object3D, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, SceneManager, System, Time } from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

/** Records the order the whole frame ran in, so a case can assert on it directly. */
const order: string[] = [];
afterEach(() => {
  order.length = 0;
});

class Tracer extends System {
  label = 'system';
  override awake() { order.push(`${this.label}:awake`); }
  override fixedUpdate() { order.push(`${this.label}:fixedUpdate`); }
  override update() { order.push(`${this.label}:update`); }
  override lateUpdate() { order.push(`${this.label}:lateUpdate`); }
  override onDestroy() { order.push(`${this.label}:onDestroy`); }
}

class Mover extends Component {
  override fixedUpdate() { order.push('component:fixedUpdate'); }
  override update() { order.push('component:update'); }
  override lateUpdate() { order.push('component:lateUpdate'); }
  override onDestroy() { order.push('component:onDestroy'); }
}

describe('systems', () => {
  it('wakes as soon as it is added, with its init already applied', async () => {
    let seen = '';
    class Reader extends System {
      label = 'default';
      override awake() { seen = this.label; }
    }
    const scene = await SceneManager.load(sceneOf(() => {}));
    const system = scene.addSystem(Reader, { label: 'authored' });

    expect(seen).toBe('authored');
    expect(system.scene).toBe(scene);
    expect(scene.getSystem(Reader)).toBe(system);
  });

  it('runs after every component in the matching phase', async () => {
    // This ordering is the reason systems exist: when a physics world steps, every
    // `fixedUpdate` that moved a body must already have run.
    Time.fixedDeltaTime = 0.02;
    await SceneManager.load(sceneOf((scene) => {
      scene.createObject().addComponent(Mover);
      scene.addSystem(Tracer);
    }));

    const clock = new Clock();
    clock.frame(0.02);
    clock.frame(0.05);

    const fixed = order.indexOf('component:fixedUpdate');
    expect(order[fixed + 1]).toBe('system:fixedUpdate');
    const update = order.indexOf('component:update');
    expect(order[update + 1]).toBe('system:update');
    const late = order.indexOf('component:lateUpdate');
    expect(order[late + 1]).toBe('system:lateUpdate');
  });

  it('steps once per fixed step, not once per frame', async () => {
    class Stepper extends System {
      steps = 0;
      seen: number[] = [];
      override fixedUpdate(dt: number) { this.steps++; this.seen.push(dt); }
    }
    Time.fixedDeltaTime = 0.02;
    const scene = await SceneManager.load(sceneOf(() => {}));
    const stepper = scene.addSystem(Stepper);

    const clock = new Clock();
    clock.frame(0.02);          // nominal 1/60 on the first frame, banked
    clock.frame(0.1);           // 0.1 + the banked 1/60 → five whole steps
    expect(stepper.steps).toBe(5);
    // A system's `fixedUpdate` sees exactly `fixedDeltaTime`, which is what makes a physics
    // step deterministic.
    expect(new Set(stepper.seen)).toEqual(new Set([0.02]));
  });

  it('only joins the phases it implements', async () => {
    class Quiet extends System {
      woke = false;
      override awake() { this.woke = true; }
    }
    const scene = await SceneManager.load(sceneOf(() => {}));
    const quiet = scene.addSystem(Quiet);
    // No tick hooks at all — it is registered, woken, and costs nothing per frame.
    expect(quiet.woke).toBe(true);
    expect(() => new Clock().frames(3)).not.toThrow();
  });

  it('holds one system of each class, and says so on a second add', async () => {
    const scene = await SceneManager.load(sceneOf(() => {}));
    scene.addSystem(Tracer);
    // A silent second physics world is far worse than an error.
    expect(() => scene.addSystem(Tracer)).toThrow(/already has a Tracer/);
  });

  it('requireSystem creates one on first ask and returns it after', async () => {
    const scene = await SceneManager.load(sceneOf(() => {}));
    const first = scene.requireSystem(Tracer, { label: 'first' });
    const second = scene.requireSystem(Tracer, { label: 'ignored' });
    expect(second).toBe(first);
    expect(first.label).toBe('first');
  });

  it('lets a component reach the service it needs without anyone installing it', async () => {
    // The registration idiom, in place of a query: the only place that knows the relationship
    // is the component, and it says so in one line.
    class Body extends Component {
      override awake() { this.requireSystem(World).add(this); }
    }
    class World extends System {
      readonly bodies: Body[] = [];
      add(body: Body) { this.bodies.push(body); }
    }
    const scene = await SceneManager.load(sceneOf((s) => {
      s.createObject('a').addComponent(Body);
      s.createObject('b').addComponent(Body);
    }));

    expect(scene.getSystem(World)?.bodies).toHaveLength(2);
  });

  it('says so plainly when a detached component asks for a scene service', () => {
    class Body extends Component {}
    const loose = new Object3D();
    const body = loose.addComponent(Body);
    class World extends System {}

    expect(body.getSystem(World)).toBe(null);
    expect(() => body.requireSystem(World)).toThrow(/needs a scene/);
  });

  it('defers removal to the end of the frame, like every other destroy', async () => {
    const scene = await SceneManager.load(sceneOf((s) => {
      s.createObject().addComponent(Mover);
      s.addSystem(Tracer);
    }));
    const system = scene.getSystem(Tracer)!;
    order.length = 0;

    system.destroy();
    expect(system.isDestroyed).toBe(false);
    // It stops ticking at once, but its teardown waits for the end of the frame.
    new Clock().frame();
    expect(order).not.toContain('system:update');
    expect(order).toContain('system:onDestroy');
    expect(system.isDestroyed).toBe(true);
    expect(scene.getSystem(Tracer)).toBe(null);
  });

  it('tears components down before the systems they unregister from', async () => {
    // A component's `onDestroy` commonly says "take me off the physics world", so the world has
    // to still be there when it runs.
    const Main = sceneOf((scene) => {
      scene.createObject().addComponent(Mover);
      scene.addSystem(Tracer);
    });
    await SceneManager.load(Main);
    order.length = 0;
    await SceneManager.unload(Main);

    expect(order.indexOf('component:onDestroy')).toBeLessThan(order.indexOf('system:onDestroy'));
  });

  it('tears systems down in reverse order of creation', async () => {
    const Main = sceneOf((scene) => {
      scene.addSystem(Tracer, { label: 'world' });
      scene.addSystem(class Debug extends Tracer {}, { label: 'debugOverWorld' });
    });
    await SceneManager.load(Main);
    order.length = 0;
    await SceneManager.unload(Main);

    // The one built on top of another goes first, so it never reads a freed world.
    expect(order).toEqual(['debugOverWorld:onDestroy', 'world:onDestroy']);
  });

  it('keeps a throwing system from taking the frame down', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Broken extends System {
      override update(): void { throw new Error('boom'); }
    }
    await SceneManager.load(sceneOf((scene) => {
      scene.addSystem(Broken);
      scene.addSystem(Tracer);
    }));

    expect(() => new Clock().frame()).not.toThrow();
    expect(order).toContain('system:update');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('drives a stand-in physics world exactly as a real one would be driven', async () => {
    // The shape a physics package will take: kinematic intent in, one step, results out.
    class Body extends Component {
      velocity = new Vector3();
      override awake() { this.requireSystem(Physics).add(this); }
    }
    class Physics extends System {
      gravity = new Vector3(0, -10, 0);
      steps = 0;
      private readonly bodies: Body[] = [];
      add(body: Body) { this.bodies.push(body); }
      override fixedUpdate(dt: number) {
        this.steps++;
        for (const body of this.bodies) {
          body.velocity.addScaledVector(this.gravity, dt);
          body.object3D.position.addScaledVector(body.velocity, dt);
        }
      }
    }
    Time.fixedDeltaTime = 0.02;
    let node!: Object3D;
    await SceneManager.load(sceneOf((scene) => {
      scene.addSystem(Physics, { gravity: new Vector3(0, -10, 0) });
      node = scene.createObject('body');
      node.addComponent(Body);
    }));

    const clock = new Clock();
    clock.frames(12, 0.02);
    expect(scene().getSystem(Physics)!.steps).toBeGreaterThan(5);
    expect(node.position.y).toBeLessThan(0);
  });
});

function scene() {
  return SceneManager.activeScene!;
}

describe('render interpolation', () => {
  it('reports how far the frame sits into the next fixed step', async () => {
    // A physics world steps at the fixed rate and renders at the frame rate. Without this the
    // only options are jitter or running physics per frame.
    Time.fixedDeltaTime = 0.02;
    const seen: number[] = [];
    class Reader extends System {
      override update() { seen.push(Time.interpolationAlpha); }
    }
    const scene = await SceneManager.load(sceneOf(() => {}));
    scene.addSystem(Reader);

    const clock = new Clock();
    clock.frames(6, 0.03);
    expect(seen.every((a) => a >= 0 && a < 1)).toBe(true);
    // 30ms frames against a 20ms step cannot land on a step boundary every time.
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});
