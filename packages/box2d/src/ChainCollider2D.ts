import { ChainShape, Vec2, type Shape } from 'planck';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider2D } from './Collider2D.js';

/** A 2D chain (polyline) collision shape (planck) — a free-form static boundary. */
@component({ name: 'ChainCollider2D', description: 'A 2D chain (polyline) collision shape (planck).' })
export class ChainCollider2D extends Collider2D {
  @property({ type: [ValueType.Vec2], default: [[-0.5, 0], [0.5, 0]], description: 'Chain vertices, e.g. "[-0.5 0,0.5 0]"' })
  points: number[][] = [
    [-0.5, 0],
    [0.5, 0],
  ];

  @property({ type: ValueType.Bool, default: false, description: 'Close the chain into a loop' })
  loop = false;

  toShape(): Shape {
    return new ChainShape(
      this.points.map(([x, y]) => new Vec2(x!, y!)),
      this.loop,
    );
  }
}
