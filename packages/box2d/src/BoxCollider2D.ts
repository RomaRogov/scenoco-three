import { BoxShape, type Shape } from 'planck';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider2D } from './Collider2D.js';

/** A 2D axis-aligned box collision shape (planck). */
@component({ name: 'BoxCollider2D', description: 'A 2D box collision shape (planck); attaches to the node’s RigidBody2D.' })
export class BoxCollider2D extends Collider2D {
  @property({ type: ValueType.Vec2, description: 'Half-extents (x, y)' })
  halfExtents = [0.5, 0.5];

  toShape(): Shape {
    const [hx, hy] = this.halfExtents;
    return new BoxShape(hx!, hy!);
  }
}
