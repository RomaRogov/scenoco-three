import { describe, expect, it, vi } from 'vitest';
import { Engine, collectAssetRefs } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Sound } from '@scenoco-three/audio';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

const scene = (extra = '') =>
  compile(`<Scene><Group id="m"><Components><Sound src="music.mp3"${extra} /></Components></Group></Scene>`);

describe('audio: <Sound> component', () => {
  it('registers via the package import and compiles in a scene', () => {
    expect(scene().components.map((c) => c.type)).toContain('Sound');
  });

  it('declares its src as an audio asset, so it is enumerated for preload', () => {
    expect(collectAssetRefs(scene())).toContainEqual({ url: 'music.mp3', kind: 'audio' });
  });

  it('preloads the decoded buffer via the AssetCache on loadSceneAsync', async () => {
    const engine = new Engine();
    const buffer = {} as AudioBuffer;
    const loader = vi.fn(async () => buffer);
    engine.assets.registerLoader(['mp3'], loader);

    await engine.loadSceneAsync(bundleScene(scene()));

    expect(loader).toHaveBeenCalledWith('music.mp3');
    expect(engine.assets.get('music.mp3')).toBe(buffer);
    engine.dispose();
  });

  it('is inert headless — no AudioContext, so the component creates no audio', () => {
    const engine = new Engine();
    engine.loadScene(bundleScene(scene(' autoplay="true"')));
    engine.tick(1 / 60); // runs start()
    expect(engine.audioListener).toBeUndefined(); // no Web Audio in node
    expect(engine.findComponent('m', Sound)!.audio).toBeUndefined();
    engine.dispose();
  });
});
