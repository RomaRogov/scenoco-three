import RAPIER from '@dimforge/rapier3d-compat';
import { Collider } from './Collider.js';

/** A 3D cylinder collision shape. Its long axis is Y. */
export class CylinderCollider extends Collider {
  radius = 0.5;
  /** Half the cylinder's height. */
  halfHeight = 0.5;

  override shapeDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cylinder(this.halfHeight, this.radius);
  }
}
