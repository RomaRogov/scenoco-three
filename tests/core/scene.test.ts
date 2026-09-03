import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Scene } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { Component, SceneManager } from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

/** A marker component — how an object is made findable, instead of a string tag. */
class Player extends Component {
  score = 0;
}

describe('scenes', () => {
  it('is a plain THREE.Scene subclass with an onLoad hook', async () => {
    class Main extends Scene {
      built = false;
      override onLoad(): void { this.built = true; }
    }
    const scene = await SceneManager.load(Main);
    expect(scene).toBeInstanceOf(Scene);
    expect(scene.built).toBe(true);
    expect(scene.isLoaded).toBe(true);
    // Keyed by class, so the lookup comes back typed as `Main`, not as `Scene`.
    expect(SceneManager.getScene(Main)).toBe(scene);
  });

  it('awaits an async onLoad before load() resolves', async () => {
    class Slow extends Scene {
      override async onLoad(): Promise<void> {
        await Promise.resolve();
        this.createObject('late').addComponent(Player);
      }
    }
    const scene = await SceneManager.load(Slow);
    expect(scene.findObjectOfType(Player)).not.toBe(null);
  });

  it('runs onLoaded once everything in the scene has awoken', async () => {
    const order: string[] = [];
    class Late extends Component { override awake() { order.push('awake'); } }
    class Main extends Scene {
      override onLoad(): void { this.createObject().addComponent(Late); }
      override onLoaded(): void { order.push('onLoaded'); }
    }
    await SceneManager.load(Main);
    expect(order).toEqual(['awake', 'onLoaded']);
  });

  it('finds components anywhere in the scene by class', async () => {
    await SceneManager.load(sceneOf((scene) => {
      scene.createObject('a').addComponent(Player, { score: 1 });
      scene.createObject('b').addComponent(Player, { score: 2 });
    }));
    const scene = SceneManager.activeScene!;
    expect(scene.findObjectOfType(Player)?.score).toBe(1);
    expect(scene.findObjectsOfType(Player)).toHaveLength(2);
  });

  it('disposes GPU resources on unload, except what keepAlive holds', async () => {
    const shared = new BoxGeometry(1, 1, 1);
    const owned = new BoxGeometry(2, 2, 2);
    const material = new MeshBasicMaterial();
    class Main extends Scene {
      override onLoad(): void {
        this.keepAlive(shared);
        this.add(new Mesh(shared, material), new Mesh(owned, material));
      }
    }
    let sharedDisposed = false;
    let ownedDisposed = false;
    shared.addEventListener('dispose', () => { sharedDisposed = true; });
    owned.addEventListener('dispose', () => { ownedDisposed = true; });

    await SceneManager.load(Main);
    await SceneManager.unload(Main);

    expect(ownedDisposed).toBe(true);
    expect(sharedDisposed).toBe(false);
  });

  it('runs onDestroy for everything in the scene on unload', async () => {
    const destroyed: string[] = [];
    class Marker extends Component {
      label = '';
      override onDestroy() { destroyed.push(this.label); }
    }
    const Main = sceneOf((scene) => {
      scene.createObject('a').addComponent(Marker, { label: 'a' });
      scene.createObject('b').addComponent(Marker, { label: 'b' });
    });
    const scene = await SceneManager.load(Main);
    await SceneManager.unload(Main);

    expect(destroyed.sort()).toEqual(['a', 'b']);
    expect(scene.componentCount).toBe(0);
    expect(scene.isLoaded).toBe(false);
  });

  it('keeps additive scenes in lockstep and ticks both', async () => {
    class Counter extends Component {
      frames = 0;
      override update() { this.frames++; }
    }
    const A = sceneOf((s) => { s.createObject().addComponent(Counter); });
    const B = sceneOf((s) => { s.createObject().addComponent(Counter); });
    const a = await SceneManager.loadAdditive(A);
    const b = await SceneManager.loadAdditive(B);

    new Clock().frames(3);
    expect(SceneManager.loadedScenes).toHaveLength(2);
    expect(a.findObjectOfType(Counter)!.frames).toBe(b.findObjectOfType(Counter)!.frames);
  });

  it('unloads every other scene when one is loaded non-additively', async () => {
    const A = sceneOf(() => {});
    const B = sceneOf(() => {});
    await SceneManager.loadAdditive(A);
    await SceneManager.load(B);
    expect(SceneManager.isLoaded(A)).toBe(false);
    expect(SceneManager.activeScene).toBe(SceneManager.getScene(B));
  });
});

/**
 * The augmentations survive being evaluated twice.
 *
 * `augment/object3d.ts` and `augment/scene.ts` patch prototypes that belong to three, and a
 * module that patches a shared prototype does not get to assume it runs once: a dev server
 * re-serving it after an unrelated file changed is enough. Non-configurable accessors made the
 * second evaluation throw `Cannot redefine property: scene` at import time, which took down
 * whatever was importing the engine — in the editor, the scene being reloaded, leaving an empty
 * viewport and no clue why.
 */
describe('prototype augmentation', () => {
  it('can be re-applied over itself', () => {
    const names = ['scene', 'activeInHierarchy', 'activeSelf', 'isDestroyed', 'components', 'eulerAngles'];
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(Object3D.prototype, name);
      expect(descriptor, `Object3D.prototype.${name}`).toBeDefined();
      expect(descriptor!.configurable, `Object3D.prototype.${name} must be configurable`).toBe(true);
      // What a second evaluation of the module does.
      expect(() => Object.defineProperty(Object3D.prototype, name, descriptor!)).not.toThrow();
    }
    for (const name of ['runtime', 'isLoaded', 'componentCount', 'systems', '_runtime']) {
      const descriptor = Object.getOwnPropertyDescriptor(Scene.prototype, name);
      expect(descriptor, `Scene.prototype.${name}`).toBeDefined();
      expect(descriptor!.configurable, `Scene.prototype.${name} must be configurable`).toBe(true);
      expect(() => Object.defineProperty(Scene.prototype, name, descriptor!)).not.toThrow();
    }
  });
});

/**
 * Loading the scene that is already loaded is a restart — Unity's `LoadScene` of the current
 * scene, the ordinary way a game says "again". It was a no-op, so every "press R" became an
 * in-place reset of each component by hand, found through the observer by an agent that had
 * done the natural thing first.
 */
describe('loading a loaded scene again', () => {
  it('rebuilds it from scratch, and leaves loadAdditive a no-op', async () => {
    let builds = 0;
    class Level extends Scene {
      override onLoad(): void {
        builds++;
        this.createObject('thing');
      }
    }
    const first = await SceneManager.load(Level);
    first.createObject('extra');
    expect(first.children).toHaveLength(2);

    const again = await SceneManager.load(Level);
    expect(again).not.toBe(first);
    expect(builds).toBe(2);
    expect(again.children).toHaveLength(1);
    expect(first.isLoaded).toBe(false);

    expect(await SceneManager.loadAdditive(Level)).toBe(again);
    expect(builds).toBe(2);
  });
});

/**
 * The gap a restart leaves, which anything watching from outside can see.
 *
 * `load` unloads the old scene and awaits the new one's `onLoad`, so between the two there is no
 * active scene. Game code cannot observe it — the frame pump runs between frames, never inside
 * this chain — but a tool driving the scene from outside can, and did: the observer answered
 * "no scene is open" while a game's own "press R" restart was in flight. This pins the shape of
 * the gap so the reason for waiting it out stays written down.
 */
describe('a restart in flight', () => {
  it('leaves no active scene until the new one has loaded', async () => {
    class Slow extends Scene {
      override async onLoad(): Promise<void> {
        await new Promise((done) => setTimeout(done, 20));
      }
    }
    await SceneManager.load(Slow);
    expect(SceneManager.activeScene).toBeInstanceOf(Slow);

    const restart = SceneManager.load(Slow); // as a game writes it: not awaited
    await new Promise((done) => setTimeout(done, 5));
    expect(SceneManager.activeScene).toBeNull();

    await restart;
    expect(SceneManager.activeScene).toBeInstanceOf(Slow);
  });
});
