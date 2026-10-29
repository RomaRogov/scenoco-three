import { Scene } from 'three';
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
    <Progress levels={[Level1, Level2, Level3]} startingLives={3} pointsPerHit={50} />
    <Music volume={0.55} />
    <Sfx volume={0.8} />
  </Scene>
);
