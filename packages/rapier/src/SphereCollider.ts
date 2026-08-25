import RAPIER from '@dimforge/rapier3d-compat';
import { Collider } from './Collider.js';

/** A 3D sphere collision shape. */
export class SphereCollider extends Collider {
  /** Radius. Match it to the visible geometry; a collider never infers one. */
  radius = 0.5;

  override shapeDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.ball(this.radius);
  }
}
