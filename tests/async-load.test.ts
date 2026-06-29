import { describe, expect, it } from 'vitest';
import { Component, Engine, component, property } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

// A fake "asset" gated behind a preload provider. The component records whether
// the asset was ready at the moment its onLoad ran — proving load ordering.
let assetReady = false;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@component({ name: 'NeedsAsset', description: 'Records whether its asset was ready at onLoad' })
class NeedsAsset extends Component {
  @property({ type: 'bool', default: false, description: 'was the asset ready at onLoad' }) sawAssetAtLoad = false;
  override onLoad(): void {
    this.sawAssetAtLoad = assetReady;
  }
}

const bundle = () => {
  const r = compileSceneXml('<Scene><Group id="g"><Components><NeedsAsset /></Components></Group></Scene>');
  if (!r.ok) throw new Error('compile failed');
  return bundleScene(r.scene);
};

describe('engine: asynchronous scene loading', () => {
  it('awaits preload providers before instantiating (onLoad sees ready assets)', async () => {
    assetReady = false;
    const engine = new Engine();
    engine.addPreloadProvider(async () => {
      await delay(10);
      assetReady = true; // the "asset" finished loading
    });

    await engine.loadSceneAsync(bundle());

    expect(assetReady).toBe(true);
    expect(engine.findComponent('g', NeedsAsset)!.sawAssetAtLoad).toBe(true);
    engine.dispose();
  });

  it('the synchronous loadScene does NOT wait — onLoad runs before the asset', () => {
    assetReady = false;
    const engine = new Engine();
    engine.addPreloadProvider(async () => {
      await delay(10);
      assetReady = true;
    });

    engine.loadScene(bundle()); // sync: instantiates immediately

    expect(engine.findComponent('g', NeedsAsset)!.sawAssetAtLoad).toBe(false);
    engine.dispose();
  });

  it('resolves like loadScene when no providers are registered', async () => {
    const engine = new Engine();
    await engine.loadSceneAsync(bundle());
    expect(engine.findObject('g')).toBeDefined();
    engine.dispose();
  });

  it('runs providers in parallel', async () => {
    const engine = new Engine();
    const order: string[] = [];
    engine.addPreloadProvider(async () => {
      await delay(20);
      order.push('slow');
    });
    engine.addPreloadProvider(async () => {
      await delay(5);
      order.push('fast');
    });
    await engine.loadSceneAsync(bundle());
    expect(order).toEqual(['fast', 'slow']); // started together; faster finished first
    engine.dispose();
  });

  it('propagates a provider failure and does not swap the scene', async () => {
    const engine = new Engine();
    engine.loadScene(bundle());
    const before = engine.findObject('g');
    engine.addPreloadProvider(async () => {
      throw new Error('asset 404');
    });
    await expect(engine.loadSceneAsync(bundle())).rejects.toThrow('asset 404');
    expect(engine.findObject('g')).toBe(before); // previous scene intact (no disposeScene ran)
    engine.dispose();
  });

  it('instantiateAsync awaits providers before spawning a prefab', async () => {
    assetReady = false;
    const engine = new Engine();
    engine.loadScene(bundle());
    engine.addPreloadProvider(async () => {
      await delay(10);
      assetReady = true;
    });
    const root = await engine.instantiateAsync(bundle());
    expect(assetReady).toBe(true);
    expect(root).toBeDefined();
    engine.dispose();
  });
});
