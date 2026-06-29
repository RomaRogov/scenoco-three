import RAPIER from '@dimforge/rapier3d-compat';
import { component, property } from '@scenoco-three/core';
import { Collider } from './Collider.js';

/** A Rapier capsule collision shape (axis-aligned along Y) — native Rapier primitive. */
@component({ name: 'CapsuleCollider', description: 'A Rapier capsule collision shape; attaches to the node’s RigidBody.' })
export class CapsuleCollider extends Collider {
  @property({ type: 'float', default: 0.5, description: 'Radius of the hemispherical caps' })
  radius = 0.5;

  @property({ type: 'float', default: 0.5, description: 'Half the distance between the cap centers (along Y)' })
  halfHeight = 0.5;

  shapeDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius);
  }
}
