import { BoxGeometry, Mesh, MeshBasicMaterial, Scene, Texture } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { Asset, SceneManager, isShared, loadAssets, shared, type SceneType } from '@scenoco-three/core';
import { resetEngine } from './helpers.js';

afterEach(resetEngine);

function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

/** Counts `dispose` on the three things `Scene.unload` frees. */
function watch(geometry: BoxGeometry, material: MeshBasicMaterial, texture: Texture) {
  const counts = { geometry: 0, material: 0, texture: 0 };
  geometry.addEventListener('dispose', () => { counts.geometry++; });
  material.addEventListener('dispose', () => { counts.material++; });
  texture.addEventListener('dispose', () => { counts.texture++; });
  return counts;
}

describe('who owns a resource', () => {
  /**
   * The case this whole mechanism exists for. `brick.material.xml` compiles to one module-scope
   * value, and every scene that references it imports the same one — so the first scene to
   * unload must not free it. Before `shared()`, it did.
   */
  it('leaves a shared asset alone when a scene that used it unloads', async () => {
    const geometry = shared(new BoxGeometry(1, 1, 1));
    const texture = shared(new Texture());
    const material = shared(new MeshBasicMaterial({ map: texture }));
    const counts = watch(geometry, material, texture);

    const First = sceneOf((s) => { s.add(new Mesh(geometry, material)); });
    const Second = sceneOf((s) => { s.add(new Mesh(geometry, material)); });

    await SceneManager.load(First);
    await SceneManager.unload(First);
    expect(counts).toEqual({ geometry: 0, material: 0, texture: 0 });

    // And the second scene still has something to render with.
    await SceneManager.load(Second);
    expect(counts).toEqual({ geometry: 0, material: 0, texture: 0 });
  });

  /** The other half: what the scene itself built is still freed, or a scene switch leaks. */
  it('frees what the scene built for itself', async () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const counts = watch(geometry, material, texture);

    const Level = sceneOf((s) => { s.add(new Mesh(geometry, material)); });
    await SceneManager.load(Level);
    await SceneManager.unload(Level);

    expect(counts).toEqual({ geometry: 1, material: 1, texture: 1 });
  });

  it('marks a value without changing what it is', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    expect(shared(geometry)).toBe(geometry);
    expect(isShared(geometry)).toBe(true);
    expect(isShared(new BoxGeometry(1, 1, 1))).toBe(false);
  });
});

/** A stand-in for `Model` and `AudioClip`: the base class is what both are. */
class Counted extends Asset<string> {
  fetches = 0;
  protected override async fetch(): Promise<string> {
    this.fetches++;
    await Promise.resolve();
    return `loaded:${this.url}`;
  }
}

describe('an asset that arrives later', () => {
  it('says what to do when it is read too early, instead of returning undefined', () => {
    const asset = new Counted('hero.glb');
    expect(asset.isLoaded).toBe(false);
    expect(() => asset.value).toThrow(/loadAssets/);
  });

  it('fetches once however many things ask at once', async () => {
    const asset = new Counted('hero.glb');
    await Promise.all([asset.load(), asset.load(), loadAssets(asset)]);
    expect(asset.fetches).toBe(1);
    expect(asset.value).toBe('loaded:hero.glb');
  });

  it('loads a whole list in parallel — what a generated scene calls', async () => {
    const model = new Counted('hero.glb');
    const clip = new Counted('step.ogg');
    await loadAssets(model, clip);
    expect(model.isLoaded && clip.isLoaded).toBe(true);
  });

  it('is loadable again after being disposed', async () => {
    const asset = new Counted('hero.glb');
    await asset.load();
    asset.dispose();
    expect(asset.isLoaded).toBe(false);
    await asset.load();
    expect(asset.fetches).toBe(2);
  });

  /**
   * A texture is not an `Asset` — three.js hands it over before the image lands, so nothing has
   * to wait for it. A scene that *does* wait shows no untextured first frame, so `loadAssets`
   * takes one anyway.
   */
  it('waits for a texture too, and for an untracked object harmlessly', async () => {
    const texture = new Texture();
    await expect(loadAssets(texture, new BoxGeometry(1, 1, 1))).resolves.toBeUndefined();
  });
});
