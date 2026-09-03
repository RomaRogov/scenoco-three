import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Scene, Vector3 } from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Component, SceneManager, Time, type SceneType } from '@scenoco-three/core';
import { BoxCollider, Physics, RigidBody, SphereCollider, initRapier } from '@scenoco-three/rapier';
import { Clock, resetEngine } from '../core/helpers.js';

// Rapier is WebAssembly, so it cannot be ready at import time. This is the one thing the 3D
// back-end needs that the 2D one does not.
beforeAll(async () => {
  await initRapier();
}, 30_000);

afterEach(resetEngine);

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshBasicMaterial();

function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

function box(
  scene: Scene,
  name: string,
  init: Partial<RigidBody> = {},
  collider: Partial<BoxCollider> = {},
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  scene.add(mesh);
  mesh.addComponent(RigidBody, init);
  mesh.addComponent(BoxCollider, { halfExtents: new Vector3(0.5, 0.5, 0.5), ...collider });
  return mesh;
}

const GROUND = { halfExtents: new Vector3(20, 0.5, 20) };

describe('the world', () => {
  it('is created on demand by the first body, with default gravity', async () => {
    const scene = await SceneManager.load(sceneOf((s) => { box(s, 'crate'); }));
    const physics = scene.getSystem(Physics)!;
    expect(physics.gravity.y).toBeCloseTo(-9.81);
    expect(physics.world).toBeTruthy();
  });

  it('takes its settings from the scene when the scene declares it', async () => {
    const scene = await SceneManager.load(sceneOf((s) => {
      s.addSystem(Physics, { gravity: new Vector3(0, -20, 0) });
      box(s, 'crate');
    }));
    expect(scene.getSystem(Physics)!.gravity.y).toBe(-20);
  });
});

describe('bodies', () => {
  it('falls under gravity and comes to rest on a fixed body', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let ball!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      const ground = box(s, 'ground', { kind: 'fixed' }, GROUND);
      ground.position.set(0, 0, 0);
      ball = box(s, 'ball');
      ball.position.set(0, 6, 0);
    }));

    const clock = new Clock();
    clock.frames(240, 1 / 60);
    // Resting on the ground's top face at y = 0.5, plus its own half-extent.
    expect(ball.position.y).toBeGreaterThan(0.5);
    expect(ball.position.y).toBeLessThan(1.6);
  });

  it('joins the world in awake and leaves it in onDestroy', async () => {
    let crate!: Mesh;
    const scene = await SceneManager.load(sceneOf((s) => { crate = box(s, 'crate'); }));
    const rigidBody = crate.getComponent(RigidBody)!;
    expect(rigidBody.body).toBeTruthy();

    crate.destroy();
    new Clock().frame();
    expect(rigidBody.body).toBe(null);
    expect(scene.getSystem(Physics)!.world.bodies.len()).toBe(0);
  });

  it('lets a kinematic body be driven by its node', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let platform!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      platform = box(s, 'platform', { kind: 'kinematic' });
    }));

    platform.position.set(3, 2, 0);
    new Clock().frames(3, 1 / 60);
    expect(platform.getComponent(RigidBody)!.body!.translation().x).toBeCloseTo(3);
  });

  it('applies an impulse', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let crate!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      s.addSystem(Physics, { gravity: new Vector3(0, 0, 0) });
      crate = box(s, 'crate');
    }));

    crate.getComponent(RigidBody)!.applyImpulse(10, 0, 0);
    new Clock().frames(20, 1 / 60);
    expect(crate.position.x).toBeGreaterThan(0.5);
  });
});

describe('colliders', () => {
  it('attaches whichever order the document declares them in', async () => {
    let node!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      node = new Mesh(geometry, material);
      s.add(node);
      // The collider first, so its `awake` runs before the body exists.
      node.addComponent(SphereCollider, { radius: 0.4 });
      node.addComponent(RigidBody);
    }));
    new Clock().frame();

    expect(node.getComponent(RigidBody)!.body!.numColliders()).toBe(1);
  });

  it('removes its collider when disabled and rebuilds it when enabled', async () => {
    let node!: Mesh;
    await SceneManager.load(sceneOf((s) => { node = box(s, 'crate'); }));
    new Clock().frame();

    const collider = node.getComponent(BoxCollider)!;
    const body = node.getComponent(RigidBody)!.body!;
    expect(body.numColliders()).toBe(1);

    collider.enabled = false;
    expect(body.numColliders()).toBe(0);
    collider.enabled = true;
    expect(body.numColliders()).toBe(1);
  });
});

describe('contacts', () => {
  it('delivers typed hooks to both sides', async () => {
    Time.fixedDeltaTime = 1 / 60;
    const seen: string[] = [];
    class Reporter extends Component {
      override onCollisionEnter(other: Object3D): void {
        seen.push(`${this.object3D.name}<-${other.name}`);
      }
    }
    await SceneManager.load(sceneOf((s) => {
      const ground = box(s, 'ground', { kind: 'fixed' }, GROUND);
      ground.addComponent(Reporter);
      const ball = box(s, 'ball');
      ball.position.set(0, 4, 0);
      ball.addComponent(Reporter);
    }));

    new Clock().frames(180, 1 / 60);
    expect(seen).toContain('ball<-ground');
    expect(seen).toContain('ground<-ball');
  });

  it('reports a sensor as a trigger, with no collision response', async () => {
    Time.fixedDeltaTime = 1 / 60;
    const triggered: string[] = [];
    let ball!: Mesh;
    class Watcher extends Component {
      override onTriggerEnter(other: Object3D): void { triggered.push(other.name); }
      override onCollisionEnter(other: Object3D): void { triggered.push(`solid:${other.name}`); }
    }
    await SceneManager.load(sceneOf((s) => {
      const sensor = box(s, 'sensor', { kind: 'fixed' }, { ...GROUND, isSensor: true });
      sensor.addComponent(Watcher);
      ball = box(s, 'ball');
      ball.position.set(0, 4, 0);
    }));

    new Clock().frames(180, 1 / 60);
    expect(triggered).toContain('ball');
    expect(triggered.some((t) => t.startsWith('solid:'))).toBe(false);
    expect(ball.position.y).toBeLessThan(-1);
  });

  it('lets a hook destroy things without corrupting the step', async () => {
    Time.fixedDeltaTime = 1 / 60;
    class Fragile extends Component {
      override onCollisionEnter(): void { this.object3D.destroy(); }
    }
    let ground!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      ground = box(s, 'ground', { kind: 'fixed' }, GROUND);
      const crate = box(s, 'crate');
      crate.position.set(0, 3, 0);
      crate.addComponent(Fragile);
    }));

    expect(() => new Clock().frames(200, 1 / 60)).not.toThrow();
    expect(ground.parent).not.toBe(null);
  });

  /**
   * Destroying a body ends its pairs, and the other side hears about it — Unity's behaviour.
   * Rapier reports the stopped event on the *next* step, naming handles that no longer exist, so
   * the handle map has to keep them resolvable until that step has been drained.
   */
  it('tells the other side when a body it touched is destroyed', async () => {
    Time.fixedDeltaTime = 1 / 60;
    const seen: string[] = [];
    class Log extends Component {
      override onTriggerEnter(other: Object3D): void { seen.push(`trigger:${other.name}`); }
      override onTriggerExit(other: Object3D): void { seen.push(`untrigger:${other.name}`); }
    }
    let slime!: Mesh;
    await SceneManager.load(sceneOf((s) => {
      const wall = box(s, 'wall', { kind: 'fixed' }, { isSensor: true });
      wall.addComponent(Log);
      slime = box(s, 'slime', { gravityScale: 0 }, { isSensor: true });
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

describe('the two back-ends agree', () => {
  it('names its hooks the same as @scenoco-three/collision does', () => {
    // A component written against one back-end runs unchanged on the other. The hooks are the
    // contract, so they are declared identically and both packages merge them onto Component.
    class Behaviour extends Component {
      override onCollisionEnter(_other: Object3D): void {}
      override onCollisionExit(_other: Object3D): void {}
      override onTriggerEnter(_other: Object3D): void {}
      override onTriggerExit(_other: Object3D): void {}
    }
    expect(new Behaviour().onCollisionEnter).toBeTypeOf('function');
  });
});
