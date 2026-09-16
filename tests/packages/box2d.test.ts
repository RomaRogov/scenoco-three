import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Scene, Vector2, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { Component, SceneManager, Time, type SceneType } from '@scenoco-three/core';
import {
  BoxCollider2D,
  CircleCollider2D,
  Physics2D,
  RigidBody2D,
} from '@scenoco-three/box2d';
import { Clock, resetEngine } from '../core/helpers.js';

afterEach(resetEngine);

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshBasicMaterial();

/** A scene built by a callback, the shape generated scene code takes. */
function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

function body(
  scene: Scene,
  name: string,
  init: Partial<RigidBody2D> = {},
  collider: Partial<BoxCollider2D> = {},
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  scene.add(mesh);
  mesh.addComponent(RigidBody2D, init);
  // Through `init`, which is what generated code does: the values are applied before `awake`,
  // so the first fixture is already built from them.
  mesh.addComponent(BoxCollider2D, { halfExtents: new Vector2(0.5, 0.5), ...collider });
  return mesh;
}

const WIDE = { halfExtents: new Vector2(10, 0.5) };

describe('the world', () => {
  it('is created on demand by the first body, with default gravity', async () => {
    const scene = await SceneManager.load(sceneOf((s) => { body(s, 'crate'); }));
    // A scene that never declared <Physics2D> still simulates. Declaring one only configures it.
    const physics = scene.getSystem(Physics2D)!;
    expect(physics).toBeInstanceOf(Physics2D);
    expect(physics.gravity.y).toBeCloseTo(-9.81);
    expect(physics.world).toBeTruthy();
  });

  it('takes its settings from the scene when the scene declares it', async () => {
    const scene = await SceneManager.load(sceneOf((s) => {
      s.addSystem(Physics2D, { gravity: new Vector2(0, 0), velocityIterations: 6 });
      body(s, 'crate');
    }));
    // The declared world won — the body did not create a second, default one.
    expect(scene.getSystem(Physics2D)!.gravity.y).toBe(0);
    expect(scene.getSystem(Physics2D)!.velocityIterations).toBe(6);
  });
});

describe('bodies', () => {
  it('falls under gravity, driving the node in the XY plane', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let crate!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      crate = body(s, 'crate');
      crate.position.set(0, 10, 3);
    }));

    const clock = new Clock();
    clock.frames(40, 1 / 60);

    expect(crate.position.y).toBeLessThan(9);
    // Z is left alone, so a 2D game can still lay its art out in depth.
    expect(crate.position.z).toBe(3);
  });

  it('simulates where the node *is*, not where its parent’s offset leaves it', async () => {
    // A wall of bricks is laid out under one node, as it would be in Unity. Reading the local
    // position put every body at its offset from that node instead: the wall was drawn where
    // the document said and collided with nothing, ten units below.
    Time.fixedDeltaTime = 1 / 60;
    let ball!: Mesh;
    let shelf!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      shelf = new Object3D();
      shelf.position.set(0, 10, 0);
      s.add(shelf);
      const plank = new Mesh(geometry, material);
      shelf.add(plank); // world y = 10, local y = 0
      plank.addComponent(RigidBody2D, { kind: 'static' });
      plank.addComponent(BoxCollider2D, WIDE);
      // Placed before its components, which is the order generated code writes.
      ball = new Mesh(geometry, material);
      s.add(ball);
      ball.position.set(0, 14, 0);
      ball.addComponent(RigidBody2D);
      ball.addComponent(BoxCollider2D, { halfExtents: new Vector2(0.5, 0.5) });
    }));

    const clock = new Clock();
    clock.frames(180, 1 / 60);

    // Landed on the plank at world y = 10, rather than falling past it.
    expect(ball.position.y).toBeGreaterThan(10.5);
    expect(ball.position.y).toBeLessThan(11.5);
  });

  it('writes a nested body’s pose back through its parent', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let crate!: Mesh;
    let holder!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      holder = new Object3D();
      holder.position.set(4, 10, 0);
      s.add(holder);
      crate = new Mesh(geometry, material);
      holder.add(crate);
      crate.addComponent(RigidBody2D);
      crate.addComponent(BoxCollider2D, { halfExtents: new Vector2(0.5, 0.5) });
    }));

    const clock = new Clock();
    clock.frames(40, 1 / 60);

    // The body is the world's, the node's transform is its parent's: the two have to agree
    // about where the crate is, which they only do if the pose is converted on the way back.
    const world = crate.getWorldPosition(new Vector3());
    const simulated = crate.getComponent(RigidBody2D)!.body!.getPosition();
    expect(world.y).toBeCloseTo(simulated.y, 5);
    expect(world.x).toBeCloseTo(4, 5);
    expect(world.y).toBeLessThan(10); // it fell
  });

  it('rests a dynamic body on a static one', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let ball!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      const ground = body(s, 'ground', { kind: 'static' }, WIDE);
      ground.position.set(0, 0, 0);
      ball = body(s, 'ball');
      ball.position.set(0, 5, 0);
    }));

    const clock = new Clock();
    clock.frames(180, 1 / 60);
    // Sitting on top of the ground: half-extent 0.5 above its surface at y = 0.5.
    expect(ball.position.y).toBeGreaterThan(0.5);
    expect(ball.position.y).toBeLessThan(1.5);
  });

  it('joins the world in awake and leaves it in onDestroy', async () => {
    let crate!: Mesh;
    const scene = await SceneManager.load(sceneOf((s) => { crate = body(s, 'crate'); }));
    const rigidBody = crate.getComponent(RigidBody2D)!;
    expect(rigidBody.body).toBeTruthy();

    crate.destroy();
    new Clock().frame();
    // No per-step reconcile scans for what came or went — the component says so itself.
    expect(rigidBody.body).toBe(null);
    expect(scene.getSystem(Physics2D)!.world.getBodyCount()).toBe(0);
  });

  it('leaves the simulation while disabled and rejoins where its node now is', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let crate!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      crate = body(s, 'crate');
      crate.position.set(0, 10, 0);
    }));
    const rigidBody = crate.getComponent(RigidBody2D)!;
    const clock = new Clock();
    clock.frames(10, 1 / 60);

    rigidBody.enabled = false;
    clock.frame();
    // A script owns the node while the body is out of the simulation.
    crate.position.set(4, 20, 0);
    clock.frames(5, 1 / 60);
    expect(crate.position.x).toBe(4);

    rigidBody.enabled = true;
    clock.frame();
    expect(rigidBody.body!.getPosition().x).toBeCloseTo(4);
    expect(rigidBody.body!.getPosition().y).toBeCloseTo(20, 0);
  });

  it('lets a kinematic body be driven by its node', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let paddle!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      paddle = body(s, 'paddle', { kind: 'kinematic' });
    }));

    paddle.position.x = 3;
    new Clock().frames(2, 1 / 60);
    expect(paddle.getComponent(RigidBody2D)!.body!.getPosition().x).toBeCloseTo(3);
  });
});

describe('colliders', () => {
  it('attaches whichever order the document declares them in', async () => {
    // The collider is listed first, so its `awake` runs before the body exists. `start` is
    // what closes that, and it is the rule core already teaches.
    let node!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      node = new Mesh(geometry, material);
      s.add(node);
      node.addComponent(CircleCollider2D, { radius: 0.3 });
      node.addComponent(RigidBody2D);
    }));
    new Clock().frame();

    const planckBody = node.getComponent(RigidBody2D)!.body!;
    expect(planckBody.getFixtureList()).toBeTruthy();
  });

  it('removes its fixture when disabled and rebuilds it when enabled', async () => {
    let node!: Mesh;
    await SceneManager.load(sceneOf((s) => { node = body(s, 'crate'); }));
    new Clock().frame();

    const collider = node.getComponent(BoxCollider2D)!;
    const planckBody = node.getComponent(RigidBody2D)!.body!;
    expect(planckBody.getFixtureList()).toBeTruthy();

    collider.enabled = false;
    expect(planckBody.getFixtureList()).toBe(null);

    collider.enabled = true;
    expect(planckBody.getFixtureList()).toBeTruthy();
  });

  it('needs rebuild() for a shape changed at runtime, and says so', async () => {
    // A planck fixture is immutable once created, so a field set afterwards cannot reach the
    // simulation on its own. `rebuild()` is the one line that applies it — and having a name
    // for it is what keeps the alternative from being a silent no-op nobody can debug.
    let node!: Mesh;
    await SceneManager.load(sceneOf((s) => { node = body(s, 'crate'); }));
    new Clock().frame();

    const collider = node.getComponent(BoxCollider2D)!;
    const planckBody = node.getComponent(RigidBody2D)!.body!;
    const before = planckBody.getFixtureList()!;

    collider.halfExtents = new Vector2(4, 4);
    expect(planckBody.getFixtureList()).toBe(before); // unchanged, as documented

    collider.rebuild();
    const after = planckBody.getFixtureList()!;
    expect(after).not.toBe(before);
  });
});

describe('contacts', () => {
  it('delivers typed hooks to both sides', async () => {
    Time.fixedDeltaTime = 1 / 60;
    const seen: string[] = [];
    class Reporter extends Component {
      override onCollisionEnter2D(other: Object3D): void {
        seen.push(`${this.object3D.name}<-${other.name}`);
      }
    }
    await SceneManager.load(sceneOf((s) => {
      const ground = body(s, 'ground', { kind: 'static' }, WIDE);
      ground.addComponent(Reporter);
      const ball = body(s, 'ball');
      ball.position.set(0, 4, 0);
      ball.addComponent(Reporter);
    }));

    new Clock().frames(120, 1 / 60);
    expect(seen).toContain('ball<-ground');
    expect(seen).toContain('ground<-ball');
  });

  it('reports a sensor as a trigger, with no collision response', async () => {
    Time.fixedDeltaTime = 1 / 60;
    const triggered: string[] = [];
    let ball!: Mesh;
    class Watcher extends Component {
      override onTriggerEnter2D(other: Object3D): void { triggered.push(other.name); }
      override onCollisionEnter2D(other: Object3D): void { triggered.push(`solid:${other.name}`); }
    }
    await SceneManager.load(sceneOf((s) => {
      const sensor = body(s, 'sensor', { kind: 'static' }, { ...WIDE, isSensor: true });
      sensor.addComponent(Watcher);
      ball = body(s, 'ball');
      ball.position.set(0, 4, 0);
    }));

    new Clock().frames(120, 1 / 60);
    expect(triggered).toContain('ball');
    expect(triggered.some((t) => t.startsWith('solid:'))).toBe(false);
    // No response: the ball passed straight through.
    expect(ball.position.y).toBeLessThan(-1);
  });

  it('lets a hook destroy things without corrupting the step', async () => {
    Time.fixedDeltaTime = 1 / 60;
    class Fragile extends Component {
      override onCollisionEnter2D(): void { this.object3D.destroy(); }
    }
    let ground!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      ground = body(s, 'ground', { kind: 'static' }, WIDE);
      const brick = body(s, 'brick');
      brick.position.set(0, 3, 0);
      brick.addComponent(Fragile);
    }));

    expect(() => new Clock().frames(150, 1 / 60)).not.toThrow();
    // The brick is gone; the ground and the world are intact.
    expect(ground.parent).not.toBe(null);
  });

  /** Destroying a body ends its contacts, and the other side hears about it — Unity's behaviour. */
  it('tells the other side when a body it touched is destroyed', async () => {
    Time.fixedDeltaTime = 1 / 60;
    const seen: string[] = [];
    class Log extends Component {
      override onTriggerEnter2D(other: Object3D): void { seen.push(`trigger:${other.name}`); }
      override onTriggerExit2D(other: Object3D): void { seen.push(`untrigger:${other.name}`); }
    }
    let slime!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      const wall = body(s, 'wall', { kind: 'static' }, { isSensor: true });
      wall.addComponent(Log);
      slime = body(s, 'slime', { gravityScale: 0 }, { isSensor: true });
      slime.position.set(0.5, 0, 0);
    }));
    const clock = new Clock();
    clock.frames(3, 1 / 60);
    expect(seen).toEqual(['trigger:slime']);

    slime.destroy();
    clock.frames(3, 1 / 60);
    expect(seen).toEqual(['trigger:slime', 'untrigger:slime']);
  });
});

describe('render interpolation', () => {
  it('moves the node between fixed steps, not only on them', async () => {
    Time.fixedDeltaTime = 0.05;
    let crate!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      crate = body(s, 'crate');
      crate.position.set(0, 10, 0);
    }));

    const clock = new Clock();
    clock.frames(4, 0.05);
    const seen = new Set<number>();
    // Frames shorter than the fixed step: most of them take no step at all, and the node should
    // still move.
    for (let i = 0; i < 6; i++) {
      clock.frame(0.012);
      seen.add(Number(crate.position.y.toFixed(5)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

/**
 * Moving a node behind the world's back, and telling the world about it.
 *
 * Only kinematic bodies follow their node during a step — for everything else the world is what
 * moves the node. That leaves a gap whenever a transform is written from outside the simulation,
 * and the gap is invisible: the object is drawn in its new place and collides in its old one.
 * An editor gizmo dragging a platform is the case this exists for.
 */
describe('syncing transforms', () => {
  it('leaves a body where it was when its node is moved from outside', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        body(s, 'platform', { kind: 'static' }, WIDE);
      }),
    );
    const platform = scene.getObjectByName('platform')!;
    const rigid = platform.getComponent(RigidBody2D)!;

    platform.position.set(3, 7, 0);
    expect(rigid.body!.getPosition().y).toBe(0); // the world never heard about it
  });

  it('moves every body to its node on `syncTransforms`', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        body(s, 'platform', { kind: 'static' }, WIDE);
        body(s, 'crate', { kind: 'dynamic' });
      }),
    );
    const platform = scene.getObjectByName('platform')!;
    const crate = scene.getObjectByName('crate')!;
    platform.position.set(3, 7, 0);
    crate.position.set(-2, 5, 0);

    scene.getSystem(Physics2D)!.syncTransforms();

    expect(platform.getComponent(RigidBody2D)!.body!.getPosition()).toMatchObject({ x: 3, y: 7 });
    expect(crate.getComponent(RigidBody2D)!.body!.getPosition()).toMatchObject({ x: -2, y: 5 });
  });

  it('lands a dropped crate on the platform where the platform now is', async () => {
    const clock = new Clock();
    const scene = await SceneManager.load(
      sceneOf((s) => {
        body(s, 'platform', { kind: 'static' }, WIDE);
        body(s, 'crate', { kind: 'dynamic' });
      }),
    );
    const platform = scene.getObjectByName('platform')!;
    const crate = scene.getObjectByName('crate')!;
    // What a session of editing looks like: both dragged, neither told the world.
    platform.position.set(0, 4, 0);
    crate.position.set(0, 8, 0);
    scene.getSystem(Physics2D)!.syncTransforms();

    clock.frames(180, 1 / 60);

    // Resting on top of the moved platform (4 + half a platform + half a crate), not falling
    // past it to where the platform used to be.
    expect(crate.position.y).toBeGreaterThan(4);
    expect(crate.position.y).toBeLessThan(6);
  });
});
