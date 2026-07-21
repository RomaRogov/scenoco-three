import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, type Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  AssetCache,
  Component,
  Engine,
  PrefabAsset,
  component,
  deserializeBundle,
  property,
  ValueType,
} from '@scenoco-three/core';
import { bundleScene, compileSceneXml, type CompileResult, type ResourceResolver } from '@scenoco-three/compiler';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};
const fakeTexture = () => ({ isTexture: true as const, dispose: vi.fn(), userData: {} as Record<string, unknown> });

describe('assets: AssetCache', () => {
  it('loads via a registered loader, caches (each URL once), and throws for an unknown extension', async () => {
    const cache = new AssetCache();
    const loader = vi.fn(async () => fakeTexture());
    cache.registerLoader(['tex'], loader);

    const a = await cache.load('x.tex');
    const b = await cache.load('x.tex');
    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(AssetCache.isManaged(a as { userData?: Record<string, unknown> })).toBe(true);
    await expect(cache.load('x.unknownext')).rejects.toThrow('No asset loader');
  });
});

describe('assets: textures + models on the engine', () => {
  it('loadSceneAsync preloads the texture and the material picks it up', async () => {
    const engine = new Engine();
    const tex = fakeTexture();
    engine.assets.registerLoader(['tex'], async () => tex);
    await engine.loadSceneAsync(
      bundleScene(compile('<Scene><Mesh id="m"><Attachments><BoxGeometry /><MeshStandardMaterial map="brick.tex" /></Attachments></Mesh></Scene>')),
    );
    const mesh = engine.findObject('m') as unknown as { material: { map: Texture | null } };
    expect(mesh.material.map).toBe(tex);
    engine.dispose();
  });

  it('clones a loaded glTF model under its host and keeps its shared resources across scene unload', async () => {
    const model = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const engine = new Engine();
    engine.assets.registerLoader(['glb'], async () => ({ scene: new Group().add(model) }));
    const geomSpy = vi.spyOn(model.geometry, 'dispose');
    const matSpy = vi.spyOn(model.material, 'dispose');

    await engine.loadSceneAsync(bundleScene(compile('<Scene><Group id="host"><Attachments><Model src="hero.glb" /></Attachments></Group></Scene>')));
    const host = engine.findObject('host')!;
    let meshes = 0;
    host.traverse((o) => { if ((o as Mesh).isMesh) meshes++; });
    expect(meshes).toBe(1); // the cloned model subtree

    engine.disposeScene();
    expect(geomSpy).not.toHaveBeenCalled(); // cache-managed, shared → not freed by scene unload
    expect(matSpy).not.toHaveBeenCalled();
    engine.dispose();
  });
});

// A fake "asset" gated behind a preload provider; the component records whether
// it was ready when its onLoad ran — proving load ordering.
let assetReady = false;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
@component({ name: 'NeedsAsset', description: 'Records whether its asset was ready at onLoad' })
class NeedsAsset extends Component {
  @property({ type: ValueType.Bool, description: 'ready at onLoad' }) sawAssetAtLoad = false;
  override onLoad(): void {
    this.sawAssetAtLoad = assetReady;
  }
}
const needsAssetBundle = () => bundleScene(compile('<Scene><Group id="g"><Components><NeedsAsset /></Components></Group></Scene>'));

describe('engine: asynchronous scene loading', () => {
  it('awaits preload providers before instantiating (onLoad sees ready assets); sync loadScene does not', async () => {
    assetReady = false;
    const asyncEngine = new Engine();
    asyncEngine.addPreloadProvider(async () => { await delay(10); assetReady = true; });
    await asyncEngine.loadSceneAsync(needsAssetBundle());
    expect(asyncEngine.findComponent('g', NeedsAsset)!.sawAssetAtLoad).toBe(true);
    asyncEngine.dispose();

    assetReady = false;
    const syncEngine = new Engine();
    syncEngine.addPreloadProvider(async () => { await delay(10); assetReady = true; });
    syncEngine.loadScene(needsAssetBundle()); // instantiates immediately
    expect(syncEngine.findComponent('g', NeedsAsset)!.sawAssetAtLoad).toBe(false);
    syncEngine.dispose();
  });
});

/**
 * A `@property({ type: ValueType.Prefab })` field receives a PrefabAsset whose `.spawn()`
 * instantiates a build-time-embedded prefab — the primitive behind spawners.
 */
@component({ name: 'PrefabSpawner', description: 'Spawns N copies of a prefab on load' })
class PrefabSpawner extends Component {
  @property({ type: ValueType.Prefab, description: 'prefab to spawn' }) prefab: PrefabAsset | null = null;
  @property({ type: ValueType.Int, description: 'how many to spawn' }) count = 3;
  readonly spawned: Object3D[] = [];
  override onLoad(): void {
    for (let i = 0; i < this.count; i++) if (this.prefab) this.spawned.push(this.prefab.spawn({ parent: this.node, position: [i, 0, 0] }));
  }
  override onDestroy(): void {
    for (const s of this.spawned) this.engine.destroy(s);
    this.spawned.length = 0;
  }
}

const cube = '<Prefab><Mesh><Attachments><BoxGeometry /><MeshStandardMaterial color="#888" /></Attachments></Mesh></Prefab>';
const resolver: ResourceResolver = (request) => (request === 'cube.prefab.xml' ? { path: request, contents: cube } : null);
const compileSpawner = (): CompileResult =>
  compileSceneXml(
    `<Scene><Object3D id="spawner"><Components><PrefabSpawner prefab="cube.prefab.xml" count="3" /></Components></Object3D></Scene>`,
    { path: '/scene.xml', resolve: resolver },
  );

describe('prefab property kind', () => {
  it('embeds the referenced prefab (round-trip safe) and hands the component a PrefabAsset whose spawn() builds a live subtree', () => {
    const r = compileSpawner();
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    expect(r.scene.prefabs).toHaveLength(1);
    const round = deserializeBundle(bundleScene(r.scene));
    expect(round.components.find((c) => c.type === 'PrefabSpawner')!.props.prefab).toEqual({ prefab: 0 });

    const engine = new Engine();
    engine.loadScene(round);
    const spawner = engine.findComponent('spawner') as PrefabSpawner;
    expect(spawner.prefab).toBeInstanceOf(PrefabAsset);
    expect(spawner.spawned).toHaveLength(3);
    let meshes = 0;
    engine.scene.traverse((o) => { if (o.type === 'Mesh') meshes++; });
    expect(meshes).toBe(3);

    engine.disposeScene(); // reload hygiene: spawned instances torn down too
    let after = 0;
    engine.scene.traverse((o) => { if (o.type === 'Mesh') after++; });
    expect(after).toBe(0);
  });
});
