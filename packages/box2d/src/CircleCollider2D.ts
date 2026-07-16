import { CircleShape, type Shape } from 'planck';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider2D } from './Collider2D.js';

/** A 2D circle collision shape (planck). */
@component({ name: 'CircleCollider2D', description: 'A 2D circle collision shape (planck); attaches to the node’s RigidBody2D.' })
export class CircleCollider2D extends Collider2D {
  @property({ type: ValueType.Float, description: 'Radius' })
  radius = 0.5;

  toShape(): Shape {
    return new CircleShape(this.radius);
  }
}
