import { Group, PerspectiveCamera, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneManager, loadAssets, type SceneType } from '@scenoco-three/core';
import { AudioClip, AudioMixer, AudioSource, hasWebAudio, sharedClip } from '@scenoco-three/audio';
import { Clock, resetEngine } from '../core/helpers.js';

afterEach(resetEngine);

function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

/** What a document's `clip="../audio/engine.ogg"` compiles to. */
const ENGINE = sharedClip('/audio/engine.ogg');

function sourceIn(scene: Scene, init: Partial<AudioSource> = {}) {
  const node = new Group();
  scene.add(node);
  return node.addComponent(AudioSource, { clip: ENGINE, ...init });
}

describe('clips', () => {
  it('is one clip per file, so ten sources decode it once', () => {
    expect(sharedClip('/audio/engine.ogg')).toBe(ENGINE);
    expect(sharedClip('/audio/other.ogg')).not.toBe(ENGINE);
  });

  /**
   * Decoding needs a Web Audio context. Headless there is none, and the deliberate answer is a
   * `null` buffer rather than a rejection: a scene with sound in it still has to load in a test.
   */
  it('loads to null where there is no Web Audio, rather than failing the scene', async () => {
    expect(hasWebAudio()).toBe(false);
    const clip = new AudioClip('/audio/nothing.ogg');
    await loadAssets(clip);
    expect(clip.isLoaded).toBe(true);
    expect(clip.value).toBeNull();
    expect(clip.duration).toBe(0);
  });
});

describe('the mixer', () => {
  it('is created on demand by the first source', async () => {
    const scene = await SceneManager.load(sceneOf((s) => { sourceIn(s); }));
    new Clock().frame();
    // `start` is where a source reaches the mixer, so it exists from the first tick.
    expect(scene.getSystem(AudioMixer)).toBeInstanceOf(AudioMixer);
  });

  it('takes the volume the scene declared rather than making a second one', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        s.addSystem(AudioMixer, { volume: 0.25 });
        sourceIn(s);
      }),
    );
    new Clock().frame();
    expect(scene.systems.filter((system) => system instanceof AudioMixer)).toHaveLength(1);
    expect(scene.getSystem(AudioMixer)!.volume).toBe(0.25);
  });

  it('has no listener without Web Audio, and does not throw looking for a camera', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        s.mainCamera = new PerspectiveCamera();
        s.add(s.mainCamera);
        sourceIn(s);
      }),
    );
    expect(() => new Clock().frames(3)).not.toThrow();
    expect(scene.getSystem(AudioMixer)!.listener).toBeNull();
  });
});

describe('a source', () => {
  it('is silent and inert headless, so a scene with sound still ticks', async () => {
    let source!: AudioSource;
    await SceneManager.load(sceneOf((s) => { source = sourceIn(s); }));
    new Clock().frames(3);

    expect(source.audio).toBeNull();
    expect(source.isPlaying).toBe(false);
    // Every method is a no-op rather than a crash — that is what "inert" has to mean.
    expect(() => {
      source.play();
      source.pause();
      source.playOneShot();
      source.stop();
    }).not.toThrow();
  });

  it('carries Unity’s defaults', () => {
    const source = new AudioSource();
    expect(source.playOnAwake).toBe(true);
    expect(source.loop).toBe(false);
    expect(source.volume).toBe(1);
    expect(source.pitch).toBe(1);
    expect(source.spatial).toBe(false);
  });

  it('reports a missing clip instead of failing silently', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await SceneManager.load(
      sceneOf((s) => {
        const node = new Group();
        s.add(node);
        node.addComponent(AudioSource);
      }),
    );
    new Clock().frame();
    // Nothing crashed; the message names the attribute to write.
    expect(String(errors.mock.calls.at(0) ?? '')).toContain('clip="../audio/engine.ogg"');
    errors.mockRestore();
  });

  it('keeps setVolume in step with the field', async () => {
    let source!: AudioSource;
    await SceneManager.load(sceneOf((s) => { source = sourceIn(s); }));
    source.setVolume(0.4);
    expect(source.volume).toBe(0.4);
  });
});
