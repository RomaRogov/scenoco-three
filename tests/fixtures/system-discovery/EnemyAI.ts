import { System, system } from '@scenoco-three/core';
import { Enemy } from './Enemy.js';

// A @system in its OWN file (not co-located with @component Enemy). The bundle
// plugin used to silently never import it; discovery now maps it under Enemy so
// it ships whenever <Enemy> is used. See CORE-IMPROVEMENTS #6.
@system(Enemy)
export class EnemyAI extends System<Enemy> {
  override step(): void {
    // would drive each enemy in this.components
  }
}
