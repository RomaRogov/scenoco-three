import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Scene, Vector3 } from 'three';
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

  it('lets the caller\'s placement win over the prefab\'s own', async () => {
    // A prefab document's root carries a transform, and the generated `onLoad` writes it. If that
    // ran last, every `instantiate(prefab, { position })` would quietly land at the prefab's
    // authored spot — a scatter of fourteen crates would be one pile at the origin.
    class Anchored extends Mesh {
      override onLoad(): void {
        this.position.set(0, 0.2, 0);
        this.scale.setScalar(0.4);
      }
    }
    let crate!: Anchored;
    await SceneManager.load(sceneOf((scene) => {
      crate = scene.instantiate(Anchored, { position: new Vector3(3, 0, -2), scale: 2 });
    }));
    expect(crate.position.toArray()).toEqual([3, 0, -2]);
    expect(crate.scale.x).toBe(2);
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

  it('answers byId for an instance given an id, and for what is inside it', async () => {
    let scene!: Scene;
    await SceneManager.load(sceneOf((s) => {
      scene = s;
      s.instantiate(Crate, { id: 'crate1', size: 1 });
      s.instantiate(Crate, { id: 'crate2', size: 3 });
    }));
    expect(scene.byId('crate2', Crate)!.scale.x).toBe(3);
    expect(scene.byId('crate1')).not.toBe(scene.byId('crate2'));
    expect(scene.byId('nothing')).toBeNull();
    // Typed by the class you pass: the wrong class is null, not a cast that lies.
    expect(scene.byId('crate1', Rotator)).toBeNull();
  });

  it('reaches a prefab\'s own ids through the instance', async () => {
    class Turret extends Group {
      barrel!: Mesh;
      spin!: Rotator;
      override onLoad(): void {
        this.barrel = new Mesh(geometry, material);
        this.add(this.barrel);
        this.spin = this.barrel.addComponent(Rotator, { speed: 4 });
      }
    }
    let scene!: Scene;
    await SceneManager.load(sceneOf((s) => {
      scene = s;
      s.instantiate(Turret, { id: 't1' });
    }));
    expect(scene.byId('t1/barrel', Mesh)).toBeInstanceOf(Mesh);
    expect(scene.byId('t1/spin', Rotator)!.speed).toBe(4);
    expect(scene.byId('t1/nothing')).toBeNull();
  });

  it('refuses a duplicate id, and frees one when its instance is destroyed', async () => {
    let scene!: Scene;
    let first!: Crate;
    await SceneManager.load(sceneOf((s) => {
      scene = s;
      first = s.instantiate(Crate, { id: 'crate' });
    }));
    expect(() => scene.instantiate(Crate, { id: 'crate' })).toThrow(/already taken/);

    first.destroy();
    new Clock().frame();
    expect(scene.byId('crate')).toBeNull();
    expect(() => scene.instantiate(Crate, { id: 'crate' })).not.toThrow();
  });

  it('frees an id the moment destroy() is called, so the next spawn can take it in the same frame', async () => {
    let scene!: Scene;
    await SceneManager.load(sceneOf((s) => {
      scene = s;
      s.instantiate(Crate, { id: 'gem1' });
    }));
    const old = scene.byId('gem1', Crate)!;
    // The ordinary reset: destroy the old one and spawn the next, in one call, before any frame.
    old.destroy();
    expect(() => scene.instantiate(Crate, { id: 'gem1' })).not.toThrow();
    expect(scene.byId('gem1')).not.toBe(old);
    new Clock().frame();
    expect(scene.byId('gem1')).not.toBe(old);
    expect(old.isDestroyed).toBe(true);
  });

  it('refuses an init key the prefab does not declare', () => {
    const parent: Object3D = new Group();
    // @ts-expect-error — `colour` is not a field of Crate.
    parent.instantiate(Crate, { colour: 'red' });
  });
});
