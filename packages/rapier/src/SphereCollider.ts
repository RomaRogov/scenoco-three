import RAPIER from '@dimforge/rapier3d-compat';
import { component, property } from '@scenoco-three/core';
import { Collider } from './Collider.js';

/** A Rapier sphere (ball) collision shape. */
@component({ name: 'SphereCollider', description: 'A Rapier sphere collision shape; attaches to the node’s RigidBody.' })
export class SphereCollider extends Collider {
  @property({ type: 'float', default: 0.5, description: 'Radius' })
  radius = 0.5;

  shapeDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.ball(this.radius);
  }
}
