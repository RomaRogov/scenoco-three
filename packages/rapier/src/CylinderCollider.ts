import RAPIER from '@dimforge/rapier3d-compat';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider } from './Collider.js';

/** A Rapier cylinder collision shape (axis-aligned along Y). */
@component({ name: 'CylinderCollider', description: 'A Rapier cylinder collision shape; attaches to the node’s RigidBody.' })
export class CylinderCollider extends Collider {
  @property({ type: ValueType.Float, description: 'Radius' })
  radius = 0.5;

  @property({ type: ValueType.Float, description: 'Half-height (along Y)' })
  halfHeight = 0.5;

  shapeDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cylinder(this.halfHeight, this.radius);
  }
}
