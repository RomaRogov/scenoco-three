import { PolygonShape, Vec2, type Shape } from 'planck';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider2D } from './Collider2D.js';

/** A 2D convex polygon collision shape (planck). Vertices must be convex and CCW. */
@component({ name: 'PolygonCollider2D', description: 'A 2D convex polygon collision shape (planck).' })
export class PolygonCollider2D extends Collider2D {
  @property({ type: [ValueType.Vec2], default: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], description: 'Convex CCW vertices, e.g. "[-0.5 -0.5,0.5 -0.5,0.5 0.5,-0.5 0.5]"' })
  points: number[][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];

  toShape(): Shape {
    return new PolygonShape(this.points.map(([x, y]) => new Vec2(x!, y!)));
  }
}
