import RAPIER from '@dimforge/rapier3d-compat';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider } from './Collider.js';

/**
 * A flat Rapier ground plane in the XZ plane — a thin cuboid (Rapier has no
 * infinite half-space collider). Pair it with a `kind="fixed"` `<RigidBody>`.
 */
@component({ name: 'PlaneCollider', description: 'A flat Rapier ground plane (thin XZ cuboid); attaches to the node’s RigidBody.' })
export class PlaneCollider extends Collider {
  @property({ type: ValueType.Vec2, description: 'Half-extents in X and Z' })
  halfExtents = [5, 5];

  shapeDesc(): RAPIER.ColliderDesc {
    const [hx, hz] = this.halfExtents;
    return RAPIER.ColliderDesc.cuboid(hx!, 0.001, hz!);
  }
}
