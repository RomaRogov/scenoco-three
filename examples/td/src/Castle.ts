import { type Object3D, Vector3 } from 'three';
import { Behaviour, instantiate, type Prefab } from '@scenoco-three/core';

/** The keep the enemies head for. It flinches and flares when one gets through. */
export class Castle extends Behaviour {
  /** The model, which flinches when hit. */
  body: Object3D | null = null;
  /** The flare over it when an enemy gets through. */
  flare: Prefab | null = null;

  hit() {
    // A squash that wobbles back — DOTween's DOPunchScale, the last one finished first.
    this.body?.doComplete();
    this.body?.doPunchScale(new Vector3(0.11, -0.22, 0.11), 0.35, 6, 0.5);
    if (this.flare) instantiate(this.flare, { position: this.node.position.clone().setY(this.node.position.y + 1.2) });
  }
}
