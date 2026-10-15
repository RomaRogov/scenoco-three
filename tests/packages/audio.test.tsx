import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, Scene } from 'three';
import { Runtime, loadAssets, wake } from '@scenoco-three/core';
import { AudioSource, sharedClip } from '@scenoco-three/audio';

const runtimes: Runtime[] = [];
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));

describe('audio', () => {
  it('runs a scene with sound headless: every source silent, every call a no-op, a missing clip said out loud', async () => {
    const engine = sharedClip('/engine.ogg');
    await loadAssets(engine);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = (
      <Scene>
        <Group>
          <AudioSource clip={engine} loop />
        </Group>
        <Group>
          <AudioSource />
        </Group>
      </Scene>
    ) as Scene;
    const runtime = new Runtime(scene);
    runtimes.push(runtime);
    wake(scene);
    runtime.update(1 / 60);

    const source = scene.children[0]!.getComponent(AudioSource)!;
    source.play();
    source.playOneShot();
    expect(source.isPlaying).toBe(false);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/AudioSource has no clip/);
    error.mockRestore();
  });
});
