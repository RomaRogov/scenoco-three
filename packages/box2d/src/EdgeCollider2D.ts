import { EdgeShape, Vec2, type Shape } from 'planck';
import { Vector2 } from 'three';
import { Collider2D } from './Collider2D.js';

/** A 2D one-sided line segment — the cheap way to build static ground. */
export class EdgeCollider2D extends Collider2D {
  /** One end, in the body's local space. */
  from = new Vector2(-0.5, 0);
  /** The other end. */
  to = new Vector2(0.5, 0);

  override toShape(): Shape {
    return new EdgeShape(new Vec2(this.from.x, this.from.y), new Vec2(this.to.x, this.to.y));
  }
}
