import { Scene } from 'three';
import { Progress } from '../Progress';
import { Level1, Level2, Level3 } from './levels';

/**
 * The run: score, lives, and which level. Loaded first, and kept across every level load
 * (`Progress` calls `dontDestroyOnLoad`), so the score outlives the level that earned it.
 */
export const Run = () => (
  <Scene>
    <Progress levels={[Level1, Level2, Level3]} startingLives={3} pointsPerHit={50} />
  </Scene>
);
