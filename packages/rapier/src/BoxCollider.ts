import RAPIER from '@dimforge/rapier3d-compat';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider } from './Collider.js';

/** A Rapier box (cuboid) collision shape. */
@component({ name: 'BoxCollider', description: 'A Rapier box (cuboid) collision shape; attaches to the node’s RigidBody.' })
export class BoxCollider extends Collider {
  @property({ type: ValueType.Vec3, required: true, description: 'Half-extents (x, y, z) — half the visible size (e.g. BoxGeometry width/height/depth ÷ 2); a collider never infers size from geometry' })
  halfExtents = [0.5, 0.5, 0.5];

  shapeDesc(): RAPIER.ColliderDesc {
    const [hx, hy, hz] = this.halfExtents;
    return RAPIER.ColliderDesc.cuboid(hx!, hy!, hz!);
  }
}
