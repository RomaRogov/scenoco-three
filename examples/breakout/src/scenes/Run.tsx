import { Group, Scene } from 'three';
import { UIDocument } from '@scenoco-three/core';
import { Bloom, ColorAdjustments, Tonemapping, Volume } from '@scenoco-three/postprocessing';
import { Music } from '../Music';
import { Progress } from '../Progress';
import { Sfx } from '../Sfx';
import { Level1, Level2, Level3 } from './levels';

/**
 * The run: score, lives, which level, and the sound. Loaded first, and kept across every level load
 * (`Progress` calls `dontDestroyOnLoad`), so the score outlives the level that earned it and the
 * music plays on through it.
 */
export const Run = () => (
  <Scene>
    <UIDocument referenceResolution={[1280, 720]} />
    <Progress levels={[Level1, Level2, Level3]} startingLives={3} pointsPerHit={50} />
    <Music volume={0.55} />
    <Sfx volume={0.8} />
    {/* A filmic curve so the neon does not clip flat, and bloom on what is brighter than white. */}
    <Group name="Look">
      <Volume />
      <Tonemapping mode="ACES" />
      <ColorAdjustments postExposure={0.1375} />
      <Bloom intensity={0.55} threshold={1} scatter={0.4} />
    </Group>
  </Scene>
);
