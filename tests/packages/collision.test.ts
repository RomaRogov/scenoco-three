import { Object3D, Scene, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { Component, SceneManager, type SceneType } from '@scenoco-three/core';
import { BoxCollider, Collision, SphereCollider } from '@scenoco-three/collision';
import { Clock, resetEngine } from '../core/helpers.js';

afterEach(resetEngine);

function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

/** Records every contact hook it receives, so a case can assert the whole exchange. */
class Log extends Component {
  readonly seen: string[] = [];
  override onCollisionEnter(other: Object3D): void { this.seen.push(`enter:${other.name}`); }
  override onCollisionExit(other: Object3D): void { this.seen.push(`exit:${other.name}`); }
  override onTriggerEnter(other: Object3D): void { this.seen.push(`trigger:${other.name}`); }
  override onTriggerExit(other: Object3D): void { this.seen.push(`untrigger:${other.name}`); }
}

function box(scene: Scene, name: string, at: Vector3, init: Partial<BoxCollider> = {}): Object3D {
  const node = scene.createObject(name);
  node.position.copy(at);
  node.addComponent(BoxCollider, { halfExtents: new Vector3(0.5, 0.5, 0.5), ...init });
  node.addComponent(Log);
  return node;
}

describe('overlap detection', () => {
  it('reports an enter the frame two shapes begin overlapping, once', async () => {
    let a!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      a = box(s, 'a', new Vector3(0, 0, 0));
      box(s, 'b', new Vector3(5, 0, 0));
    }));
    const clock = new Clock();
    clock.frame();
    expect(a.getComponent(Log)!.seen).toEqual([]);

    a.position.x = 4.5;
    clock.frames(3);
    // Once, not once per frame the overlap continues.
    expect(a.getComponent(Log)!.seen).toEqual(['enter:b']);
  });

  it('reports an exit the frame the overlap ends', async () => {
    let a!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      a = box(s, 'a', new Vector3(0, 0, 0));
      box(s, 'b', new Vector3(0.5, 0, 0));
    }));
    const clock = new Clock();
    clock.frame();
    expect(a.getComponent(Log)!.seen).toEqual(['enter:b']);

    a.position.x = 20;
    clock.frames(2);
    expect(a.getComponent(Log)!.seen).toEqual(['enter:b', 'exit:b']);
  });

  it('tells both sides', async () => {
    let a!: Object3D;
    let b!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      a = box(s, 'a', new Vector3(0, 0, 0));
      b = box(s, 'b', new Vector3(0.5, 0, 0));
    }));
    new Clock().frame();
    expect(a.getComponent(Log)!.seen).toEqual(['enter:b']);
    expect(b.getComponent(Log)!.seen).toEqual(['enter:a']);
  });

  it('fires the trigger pair when either side is a sensor', async () => {
    let a!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      a = box(s, 'a', new Vector3(0, 0, 0));
      box(s, 'gate', new Vector3(0.5, 0, 0), { isSensor: true });
    }));
    new Clock().frame();
    expect(a.getComponent(Log)!.seen).toEqual(['trigger:gate']);
  });

  it('reads world transforms, so a parent’s move counts', async () => {
    let group!: Object3D;
    let child!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      group = s.createObject('group');
      child = new Object3D();
      child.name = 'child';
      child.addComponent(BoxCollider, { halfExtents: new Vector3(0.5, 0.5, 0.5) });
      child.addComponent(Log);
      group.add(child);
      group.position.set(10, 0, 0);
      box(s, 'target', new Vector3(0, 0, 0));
    }));
    const clock = new Clock();
    clock.frame();
    expect(child.getComponent(Log)!.seen).toEqual([]);

    // Only the parent moves; the child's own position never changes.
    group.position.set(0.5, 0, 0);
    clock.frame();
    expect(child.getComponent(Log)!.seen).toEqual(['enter:target']);
  });

  it('does not pair two shapes on one node', async () => {
    let node!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      node = s.createObject('multi');
      node.addComponent(BoxCollider, { halfExtents: new Vector3(1, 1, 1) });
      node.addComponent(SphereCollider, { radius: 1 });
      node.addComponent(Log);
    }));
    new Clock().frames(2);
    // Two shapes describe one thing; they do not touch each other.
    expect(node.getComponent(Log)!.seen).toEqual([]);
  });

  it('treats a disabled collider as gone, and ends its overlaps', async () => {
    let a!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      a = box(s, 'a', new Vector3(0, 0, 0));
      box(s, 'b', new Vector3(0.5, 0, 0));
    }));
    const clock = new Clock();
    clock.frame();
    expect(a.getComponent(Log)!.seen).toEqual(['enter:b']);

    a.getComponent(BoxCollider)!.enabled = false;
    clock.frame();
    expect(a.getComponent(Log)!.seen).toEqual(['enter:b', 'exit:b']);
  });

  it('unregisters a destroyed collider', async () => {
    let b!: Object3D;
    const scene = await SceneManager.load(sceneOf((s) => {
      box(s, 'a', new Vector3(0, 0, 0));
      b = box(s, 'b', new Vector3(0.5, 0, 0));
    }));
    const clock = new Clock();
    clock.frame();

    b.destroy();
    clock.frames(2);
    expect(() => clock.frame()).not.toThrow();
    expect(scene.getSystem(Collision)).toBeTruthy();
  });
});

describe('sphere overlap', () => {
  it('uses the radius, not a box around it', async () => {
    let a!: Object3D;
    await SceneManager.load(sceneOf((s) => {
      a = s.createObject('a');
      a.addComponent(SphereCollider, { radius: 1 });
      a.addComponent(Log);
      const b = s.createObject('b');
      b.position.set(1.5, 1.5, 0);
      b.addComponent(SphereCollider, { radius: 1 });
    }));
    const clock = new Clock();
    clock.frame();
    // Centres are √4.5 ≈ 2.12 apart, more than the two radii — a box test would have said yes.
    expect(a.getComponent(Log)!.seen).toEqual([]);

    a.position.set(0.5, 0.5, 0);
    clock.frame();
    expect(a.getComponent(Log)!.seen).toEqual(['enter:b']);
  });
});
