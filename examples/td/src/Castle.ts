import { Behaviour, instantiate, type Prefab } from '@scenoco-three/core';
import { Punch } from './Punch';

/** The keep the enemies head for. It flinches and flares when one gets through. */
export class Castle extends Behaviour {
  /** The flare over it when an enemy gets through. */
  flare: Prefab | null = null;

  hit() {
    this.getComponentInChildren(Punch)?.punch(0.22);
    if (this.flare) instantiate(this.flare, { position: this.node.position.clone().setY(this.node.position.y + 1.2) });
  }
}
