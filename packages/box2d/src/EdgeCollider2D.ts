import { EdgeShape, Vec2, type Shape } from 'planck';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider2D } from './Collider2D.js';

/** A 2D edge (one-sided line segment) collision shape (planck) — handy for static ground. */
@component({ name: 'EdgeCollider2D', description: 'A 2D edge (line segment) collision shape (planck).' })
export class EdgeCollider2D extends Collider2D {
  @property({ type: ValueType.Vec2, description: 'Segment start (x, y)' })
  from = [-0.5, 0];

  @property({ type: ValueType.Vec2, description: 'Segment end (x, y)' })
  to = [0.5, 0];

  toShape(): Shape {
    return new EdgeShape(new Vec2(this.from[0]!, this.from[1]!), new Vec2(this.to[0]!, this.to[1]!));
  }
}
