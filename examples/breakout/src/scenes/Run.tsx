import { Group, Scene } from 'three';
import { UIDocument } from '@scenoco-three/core';
import { Bloom, ChromaticAberration, ColorAdjustments, Tonemapping, Vignette, Volume } from '@scenoco-three/postprocessing';
import { HitLook } from '../HitLook';
import { Music } from '../Music';
import { Progress } from '../Progress';
import { RunHud } from '../RunHud';
import { Sfx } from '../Sfx';
import { Level1, Level2, Level3 } from './levels';

/**
 * The run: score, lives, which level, the HUD that shows them, and the sound. Loaded first, and kept across every level load
 * (`Progress` calls `dontDestroyOnLoad`), so the score outlives the level that earned it and the
 * music plays on through it.
 */
export const Run = () => (
  <Scene>
    <UIDocument referenceResolution={[1280, 720]} />
    <Progress levels={[Level1, Level2, Level3]} startingLives={3} pointsPerHit={50} />
    <RunHud />
    <Music volume={0.55} />
    <Sfx volume={0.8} />
    {/* A filmic curve so the neon does not clip flat, bloom on what is brighter than white — and the hits, through HitLook. */}
    <Group name="Look">
      <Volume />
      <Tonemapping mode="ACES" />
      <ColorAdjustments postExposure={0.1375} />
      <Bloom intensity={3} threshold={0.6} scatter={0.6} />
      <Vignette intensity={0.18} smoothness={0.35} />
      <ChromaticAberration intensity={0} />
      <HitLook />
    </Group>
  </Scene>
);
