import RAPIER from '@dimforge/rapier3d-compat';
import { Vector2 } from 'three';
import { Collider } from './Collider.js';

/**
 * A flat ground plane, in the XZ plane.
 *
 * Rapier has no infinite plane, so this is a very thin box — which is what you want anyway, as
 * a truly infinite plane makes a fallen object impossible to find.
 */
export class PlaneCollider extends Collider {
  /** Half the plane's extent on X and Z. */
  halfExtents = new Vector2(5, 5);

  override shapeDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cuboid(this.halfExtents.x, THICKNESS, this.halfExtents.y);
  }
}

/** Thin enough not to be seen, thick enough that nothing tunnels through it. */
const THICKNESS = 0.05;
