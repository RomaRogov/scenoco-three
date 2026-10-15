import { afterEach, describe, expect, it } from 'vitest';
import { BatchedRenderer } from 'three.quarks';
import { Group, Scene } from 'three';
import { Runtime, wake } from '@scenoco-three/core';
import { ParticleSystem, type ParticleEffect } from '@scenoco-three/particles';

const runtimes: Runtime[] = [];
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));

const sparks: ParticleEffect = { duration: 1, startLifetime: 0.5, emission: { rateOverTime: 60 } };

describe('particles', () => {
  it('plays an effect: one batch for the scene, stepped every frame, paused with its behaviour', () => {
    const scene = (
      <Scene>
        <Group>
          <ParticleSystem effect={sparks} />
        </Group>
        <Group>
          <ParticleSystem effect={sparks} playOnAwake={false} />
        </Group>
      </Scene>
    ) as Scene;
    const runtime = new Runtime(scene);
    runtimes.push(runtime);
    wake(scene);
    for (let i = 0; i < 30; i++) runtime.update(1 / 60);

    expect(scene.children.filter((c) => c instanceof BatchedRenderer)).toHaveLength(1);
    const [playing, waiting] = scene.children.slice(0, 2).map((g) => g.getComponent(ParticleSystem)!);
    expect(playing!.isPlaying).toBe(true);
    expect(waiting!.isPlaying).toBe(false);
    playing!.enabled = false;
    expect(playing!.isPlaying).toBe(false);
  });
});
