import { describe, expect, it } from 'vitest';
import { Group, Scene } from 'three';
import { simulate } from '@scenoco-three/core';
import { Bloom, Tonemapping, Volume } from '@scenoco-three/postprocessing';

describe('Volume', () => {
  it('does nothing under simulate, where nothing is drawn', () => {
    const game = simulate(() => (
      <Scene>
        <Group>
          <Volume />
          <Bloom intensity={0.5} />
          <Tonemapping />
        </Group>
      </Scene>
    ));
    game.step(3);
    game.dispose();
    expect(game.scene.children).toEqual([]);
  });
});
