import { Behaviour } from '@scenoco-three/core';
import { Rigidbody } from '@scenoco-three/rapier';

/**
 * Unity's Freeze Rotation X and Y: the letter may tip over sideways but never turns its back or
 * falls flat, so the word stays readable. Rapier's own call, on the body the Rigidbody made.
 */
export class FaceFront extends Behaviour {
  override start() {
    this.getComponent(Rigidbody)?.rapierBody?.setEnabledRotations(false, false, true, true);
  }
}
