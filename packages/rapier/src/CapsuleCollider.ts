import RAPIER from '@dimforge/rapier3d-compat';
import { Collider } from './Collider.js';

/** A 3D capsule — the usual shape for a character. Its long axis is Y. */
export class CapsuleCollider extends Collider {
  /** Radius of the cylinder and of the caps. */
  radius = 0.5;
  /** Half the length of the straight section, not counting the caps. */
  halfHeight = 0.5;

  override shapeDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius);
  }
}
