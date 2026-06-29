import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetCache, Engine, collectAssetRefs } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

// A fake Texture (no GPU/DOM) so the whole pipeline is headless-testable.
const fakeTexture = () => ({ isTexture: true as const, dispose: vi.fn(), userData: {} as Record<string, unknown> });
// A fake loaded glTF: a real subtree the Model attachment can clone + add.
const fakeModel = () => {
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const scene = new Group();
  scene.add(mesh);
  return { scene, mesh };
};

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

describe('assets: scene enumeration', () => {
  it('collects texture + model asset URLs (incl. nested prefab) by declared kind', () => {
    const scene = compile(`<Scene>
      <Mesh id="m"><BoxGeometry /><MeshStandardMaterial map="brick.tex" normalMap="brick_n.tex" /></Mesh>
      <Group><Model src="hero.glb" /></Group>
    </Scene>`);
    const refs = collectAssetRefs(scene);
    expect(refs).toEqual(
      expect.arrayContaining([
        { url: 'brick.tex', kind: 'texture' },
        { url: 'brick_n.tex', kind: 'texture' },
        { url: 'hero.glb', kind: 'model' },
      ]),
    );
    // Unset texture attrs (empty default) are not collected.
    expect(refs.find((r) => r.url === '')).toBeUndefined();
  });
});

describe('assets: AssetCache', () => {
  it('loads via a registered loader, caches, and loads each URL once', async () => {
    const cache = new AssetCache();
    const loader = vi.fn(async () => fakeTexture());
    cache.registerLoader(['tex'], loader);

    const a = await cache.load('x.tex');
    const b = await cache.load('x.tex');
    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.get('x.tex')).toBe(a);
    expect(AssetCache.isManaged(a as { userData?: Record<string, unknown> })).toBe(true);
  });

  it('throws for an extension with no loader', async () => {
    await expect(new AssetCache().load('x.unknownext')).rejects.toThrow('No asset loader');
  });
});

describe('assets: end-to-end texture on a material', () => {
  it('loadSceneAsync preloads the texture and the material picks it up', async () => {
    const engine = new Engine();
    const tex = fakeTexture();
    engine.assets.registerLoader(['tex'], async () => tex);

    await engine.loadSceneAsync(
      bundleScene(compile('<Scene><Mesh id="m"><BoxGeometry /><MeshStandardMaterial map="brick.tex" /></Mesh></Scene>')),
    );

    const mesh = engine.findObject('m') as unknown as { material: { map: Texture | null } };
    expect(mesh.material.map).toBe(tex);
    engine.dispose();
  });

  it('synchronous loadScene streams the texture in once it loads', async () => {
    const engine = new Engine();
    const tex = fakeTexture();
    engine.assets.registerLoader(['tex'], async () => tex);
    engine.loadScene(
      bundleScene(compile('<Scene><Mesh id="m"><BoxGeometry /><MeshBasicMaterial map="brick.tex" /></Mesh></Scene>')),
    );
    const mesh = engine.findObject('m') as unknown as { material: { map: Texture | null } };
    expect(mesh.material.map).toBeNull(); // not loaded synchronously…
    await new Promise((r) => setTimeout(r)); // …flush the background load
    expect(mesh.material.map).toBe(tex); // …then it streams in
    engine.dispose();
  });

  it('cache-managed textures survive scene unload, freed only by the cache', async () => {
    const engine = new Engine();
    const tex = fakeTexture();
    engine.assets.registerLoader(['tex'], async () => tex);
    await engine.loadSceneAsync(
      bundleScene(compile('<Scene><Mesh id="m"><BoxGeometry /><MeshStandardMaterial map="brick.tex" /></Mesh></Scene>')),
    );

    engine.disposeScene();
    expect(tex.dispose).not.toHaveBeenCalled(); // shared asset outlives the scene

    engine.assets.dispose();
    expect(tex.dispose).toHaveBeenCalled(); // freed by the cache
    engine.dispose();
  });
});

describe('assets: glTF model attachment', () => {
  it('clones the loaded model under its host node and preserves shared resources', async () => {
    const engine = new Engine();
    const model = fakeModel();
    engine.assets.registerLoader(['glb'], async () => ({ scene: model.scene }));
    const geomSpy = vi.spyOn(model.mesh.geometry, 'dispose');
    const matSpy = vi.spyOn(model.mesh.material, 'dispose');

    await engine.loadSceneAsync(
      bundleScene(compile('<Scene><Group id="host"><Model src="hero.glb" /></Group></Scene>')),
    );

    const host = engine.findObject('host')!;
    expect(host.children.length).toBe(1); // the cloned model subtree
    let meshes = 0;
    host.traverse((o) => {
      if ((o as Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(1);

    // The clone shares the cached geometry/material (managed) — scene unload must not free them.
    engine.disposeScene();
    expect(geomSpy).not.toHaveBeenCalled();
    expect(matSpy).not.toHaveBeenCalled();
    engine.dispose();
  });
});
