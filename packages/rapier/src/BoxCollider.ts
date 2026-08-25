import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Collider } from './Collider.js';

/** A 3D box collision shape. */
export class BoxCollider extends Collider {
  /**
   * Half the box's size — half the *visible* size, if it is meant to match the mesh.
   *
   * A collider never infers its size from the geometry beside it. The two are separate assets,
   * and a collider that guessed would be wrong the moment either changed.
   */
  halfExtents = new Vector3(0.5, 0.5, 0.5);

  override shapeDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cuboid(this.halfExtents.x, this.halfExtents.y, this.halfExtents.z);
  }
}
