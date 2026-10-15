import { Behaviour } from '@scenoco-three/core';

/** A box the runner must not touch: it spans yMin..yMax in height. */
export class Obstacle extends Behaviour {
  kind: 'train' | 'low' | 'high' = 'train';
  yMin = 0;
  yMax = 1;
  halfX = 1;
  halfZ = 0.5;
}
