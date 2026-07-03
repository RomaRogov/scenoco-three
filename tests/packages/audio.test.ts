import { describe, expect, it, vi } from 'vitest';
import { Engine, collectAssetRefs } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Sound } from '@scenoco-three/audio';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};
const scene = (extra = '') => compile(`<Scene><Group id="m"><Components><Sound src="music.mp3"${extra} /></Components></Group></Scene>`);

describe('audio: <Sound> component', () => {
  it('declares its src as an audio asset and preloads the decoded buffer via the AssetCache', async () => {
    expect(collectAssetRefs(scene())).toContainEqual({ url: 'music.mp3', kind: 'audio' });
    const engine = new Engine();
    const buffer = {} as AudioBuffer;
    engine.assets.registerLoader(['mp3'], vi.fn(async () => buffer));
    await engine.loadSceneAsync(bundleScene(scene()));
    expect(engine.assets.get('music.mp3')).toBe(buffer);
    engine.dispose();
  });

  it('is inert headless — no AudioContext, so the component creates no audio', () => {
    const engine = new Engine();
    engine.loadScene(bundleScene(scene(' autoplay="true"')));
    engine.tick(1 / 60); // runs start()
    expect(engine.audioListener).toBeUndefined();
    expect(engine.findComponent('m', Sound)!.audio).toBeUndefined();
    engine.dispose();
  });
});
