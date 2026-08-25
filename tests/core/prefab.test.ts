import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, SceneManager } from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshBasicMaterial();

class Rotator extends Component {
  speed = 1;
  override update(dt: number) { this.object3D.rotation.y += this.speed * dt; }
}

/**
 * A prefab rooted at a mesh, in the shape the compiler emits: no base class, no wrapper —
 * the prefab class *is* the node type it produces.
 */
class Crate extends Mesh {
  size = 1;
  seenPositionInAwake = new Vector3();

  override onLoad(): void {
    this.geometry = geometry;
    this.material = material;
    this.scale.setScalar(this.size);
    this.addComponent(Rotator, { speed: 2 });
    this.addComponent(Watcher);
  }
}

/** Records where its object was when it woke, to prove placement happens before `awake`. */
class Watcher extends Component<Crate> {
  override awake() { this.object3D.seenPositionInAwake.copy(this.object3D.position); }
}

describe('prefabs', () => {
  it('instantiates as its own Three.js type, with no wrapper node', async () => {
    let crate!: Crate;
    await SceneManager.load(sceneOf((scene) => {
      crate = scene.instantiate(Crate, { position: new Vector3(0, 1, 0), size: 0.5 });
    }));

    expect(crate).toBeInstanceOf(Mesh);
    expect(crate.geometry).toBe(geometry);
    expect(crate.scale.x).toBe(0.5);
    // The mesh is the root: nothing sits between it and its parent.
    expect(crate.parent?.type).toBe('Scene');
    expect(crate.children).toHaveLength(0);
  });

  it('places the prefab before onLoad, so every awake below sees the final transform', async () => {
    let crate!: Crate;
    await SceneManager.load(sceneOf((scene) => {
      crate = scene.instantiate(Crate, { position: new Vector3(3, 0, 0) });
    }));
    expect(crate.seenPositionInAwake.x).toBe(3);
  });

  it('takes rotation in degrees', async () => {
    let crate!: Crate;
    await SceneManager.load(sceneOf((scene) => {
      crate = scene.instantiate(Crate, { eulerAngles: new Vector3(0, 90, 0) });
    }));
    expect(crate.eulerAngles.y).toBeCloseTo(90);
    expect(crate.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it('builds each instance from the definition, so instances never share state', async () => {
    let a!: Crate;
    let b!: Crate;
    await SceneManager.load(sceneOf((scene) => {
      a = scene.instantiate(Crate, { size: 1 });
      b = scene.instantiate(Crate, { size: 3 });
    }));
    expect(a.scale.x).toBe(1);
    expect(b.scale.x).toBe(3);
    expect(a.getComponent(Rotator)).not.toBe(b.getComponent(Rotator));
  });

  it('runs the prefab lifecycle exactly once per instance', async () => {
    const awoken = vi.fn();
    class Once extends Component { override awake() { awoken(); } }
    class Thing extends Group {
      override onLoad(): void { this.addComponent(Once); }
    }
    await SceneManager.load(sceneOf((scene) => {
      const parent = scene.createObject('parent');
      parent.instantiate(Thing);
    }));
    new Clock().frame();
    expect(awoken).toHaveBeenCalledTimes(1);
  });

  it('warns when a prefab is added with add() instead of instantiate()', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await SceneManager.load(sceneOf((scene) => {
      scene.add(new Crate());
    }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('instantiate'));
    warn.mockRestore();
  });

  it('refuses an init key the prefab does not declare', () => {
    const parent: Object3D = new Group();
    // @ts-expect-error — `colour` is not a field of Crate.
    parent.instantiate(Crate, { colour: 'red' });
  });
});
