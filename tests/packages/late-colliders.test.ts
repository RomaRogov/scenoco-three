import { Object3D, Scene, Vector2, Vector3 } from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Component, SceneManager, Time, type SceneType } from '@scenoco-three/core';
import { BoxCollider, Collision } from '@scenoco-three/collision';
import { BoxCollider2D, Physics2D, RigidBody2D } from '@scenoco-three/box2d';
import {
  BoxCollider as BoxCollider3D,
  Physics,
  RigidBody,
  initRapier,
} from '@scenoco-three/rapier';
import { Clock, resetEngine } from '../core/helpers.js';

/**
 * A collider that arrives **after** the scene is running.
 *
 * Everything a document authors is attached before the first frame, which is the path every
 * other test takes. A game spawns things: a prefab instantiated mid-round, a collider added to a
 * node that already existed. Each back-end registers on a different hook — box2d and rapier ask
 * the body in `start` and again in `onEnable`, collision registers itself in `awake` — so
 * "does a late collider take part in the simulation" is three separate questions with one answer
 * expected.
 */
beforeAll(async () => {
  await initRapier();
}, 30_000);

afterEach(resetEngine);

function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

/**
 * Records the contacts a node is told about, whichever back-end told it.
 *
 * Three sets of hook names, because the 2D back-end suffixes its — `onTriggerEnter2D` — so that
 * a node can carry both simulations without one back-end answering the other's contacts.
 */
class Log extends Component {
  readonly seen: string[] = [];
  override onCollisionEnter(other: Object3D): void {
    this.seen.push(`enter:${other.name}`);
  }
  override onTriggerEnter(other: Object3D): void {
    this.seen.push(`trigger:${other.name}`);
  }
  override onTriggerEnter2D(other: Object3D): void {
    this.seen.push(`trigger:${other.name}`);
  }
  override onCollisionEnter2D(other: Object3D): void {
    this.seen.push(`enter:${other.name}`);
  }
}

const seenBy = (node: Object3D): string[] => node.getComponent(Log)!.seen;

describe('a collider added after the scene is running', () => {
  it('takes part in collision detection', async () => {
    let scene!: Scene;
    await SceneManager.load(
      sceneOf((s) => {
        scene = s;
        const resting = s.createObject('resting');
        resting.position.set(0, 0, 0);
        resting.addComponent(BoxCollider, { halfExtents: new Vector3(0.5, 0.5, 0.5) });
        resting.addComponent(Log);
      }),
    );
    const clock = new Clock();
    clock.frame();

    // The late arrival: a node and a collider built by hand, mid-round.
    const late = scene.createObject('late');
    late.position.set(4, 0, 0);
    late.addComponent(BoxCollider, { halfExtents: new Vector3(0.5, 0.5, 0.5) });
    late.addComponent(Log);
    clock.frame();
    expect(seenBy(late)).toEqual([]);

    late.position.x = 0.5;
    clock.frames(2);
    expect(seenBy(late)).toEqual(['enter:resting']);
    expect(seenBy(scene.getObjectByName('resting')!)).toEqual(['enter:late']);
  });

  it('takes part in the 2D simulation', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let scene!: Scene;
    await SceneManager.load(
      sceneOf((s) => {
        scene = s;
        s.addSystem(Physics2D, { gravity: new Vector2(0, -9.81) });
        const sensor = s.createObject('sensor');
        sensor.addComponent(RigidBody2D, { kind: 'static' });
        sensor.addComponent(BoxCollider2D, { halfExtents: new Vector2(4, 0.5), isSensor: true });
        sensor.addComponent(Log);
      }),
    );
    const clock = new Clock();
    clock.frame();

    // The late arrival: body and collider both built after the first frame has run.
    const falling = scene.createObject('falling');
    falling.position.set(0, 5, 0);
    falling.addComponent(RigidBody2D, { kind: 'dynamic' });
    falling.addComponent(BoxCollider2D, { halfExtents: new Vector2(0.25, 0.25) });

    clock.frames(120, 1 / 60);
    expect(seenBy(scene.getObjectByName('sensor')!)).toContain('trigger:falling');
  });

  it('takes part in the 3D simulation', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let scene!: Scene;
    await SceneManager.load(
      sceneOf((s) => {
        scene = s;
        s.addSystem(Physics, { gravity: new Vector3(0, -9.81, 0) });
        const sensor = s.createObject('sensor');
        sensor.addComponent(RigidBody, { kind: 'fixed' });
        sensor.addComponent(BoxCollider3D, {
          halfExtents: new Vector3(4, 0.5, 4),
          isSensor: true,
        });
        sensor.addComponent(Log);
      }),
    );
    const clock = new Clock();
    clock.frame();

    const falling = scene.createObject('falling');
    falling.position.set(0, 5, 0);
    falling.addComponent(RigidBody, { kind: 'dynamic' });
    falling.addComponent(BoxCollider3D, { halfExtents: new Vector3(0.25, 0.25, 0.25) });

    clock.frames(120, 1 / 60);
    expect(seenBy(scene.getObjectByName('sensor')!)).toContain('trigger:falling');
  });
});

/**
 * The same question asked the way a game actually asks it.
 *
 * `instantiate` builds a prefab **detached** — `onLoad` runs, then the whole subtree enters the
 * scene in one `add` — so its components wake in a different order from ones added to a node
 * already in the graph. A spawner firing mid-round is the commonest source of a late collider,
 * and it is the path that would break silently: the thing appears, and falls through the world.
 */
describe('a prefab spawned mid-round', () => {
  class Detectable extends Object3D {
    override onLoad(): void {
      this.name = 'spawned';
      this.addComponent(BoxCollider, { halfExtents: new Vector3(0.5, 0.5, 0.5) });
      this.addComponent(Log);
    }
  }

  class Falling2D extends Object3D {
    override onLoad(): void {
      this.name = 'spawned';
      this.addComponent(RigidBody2D, { kind: 'dynamic' });
      this.addComponent(BoxCollider2D, { halfExtents: new Vector2(0.25, 0.25) });
    }
  }

  class Falling3D extends Object3D {
    override onLoad(): void {
      this.name = 'spawned';
      this.addComponent(RigidBody, { kind: 'dynamic' });
      this.addComponent(BoxCollider3D, { halfExtents: new Vector3(0.25, 0.25, 0.25) });
    }
  }

  it('is detected by the collision back-end', async () => {
    let scene!: Scene;
    await SceneManager.load(
      sceneOf((s) => {
        scene = s;
        const resting = s.createObject('resting');
        resting.addComponent(BoxCollider, { halfExtents: new Vector3(0.5, 0.5, 0.5) });
        resting.addComponent(Log);
      }),
    );
    const clock = new Clock();
    clock.frame();

    const spawned = scene.instantiate(Detectable, { position: new Vector3(0.5, 0, 0) });
    clock.frames(2);
    expect(seenBy(spawned)).toEqual(['enter:resting']);
  });

  it('is simulated by the 2D back-end', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let scene!: Scene;
    await SceneManager.load(
      sceneOf((s) => {
        scene = s;
        s.addSystem(Physics2D, { gravity: new Vector2(0, -9.81) });
        const sensor = s.createObject('sensor');
        sensor.addComponent(RigidBody2D, { kind: 'static' });
        sensor.addComponent(BoxCollider2D, { halfExtents: new Vector2(4, 0.5), isSensor: true });
        sensor.addComponent(Log);
      }),
    );
    const clock = new Clock();
    clock.frame();

    scene.instantiate(Falling2D, { position: new Vector3(0, 5, 0) });
    clock.frames(120, 1 / 60);
    expect(seenBy(scene.getObjectByName('sensor')!)).toContain('trigger:spawned');
  });

  it('is simulated by the 3D back-end', async () => {
    Time.fixedDeltaTime = 1 / 60;
    let scene!: Scene;
    await SceneManager.load(
      sceneOf((s) => {
        scene = s;
        s.addSystem(Physics, { gravity: new Vector3(0, -9.81, 0) });
        const sensor = s.createObject('sensor');
        sensor.addComponent(RigidBody, { kind: 'fixed' });
        sensor.addComponent(BoxCollider3D, { halfExtents: new Vector3(4, 0.5, 4), isSensor: true });
        sensor.addComponent(Log);
      }),
    );
    const clock = new Clock();
    clock.frame();

    scene.instantiate(Falling3D, { position: new Vector3(0, 5, 0) });
    clock.frames(120, 1 / 60);
    expect(seenBy(scene.getObjectByName('sensor')!)).toContain('trigger:spawned');
  });
});
