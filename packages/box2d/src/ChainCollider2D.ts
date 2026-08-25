import { ChainShape, Vec2, type Shape } from 'planck';
import { Vector2 } from 'three';
import { Collider2D } from './Collider2D.js';

/**
 * A 2D chain of line segments — terrain, a track, any long static outline that a polygon
 * cannot be because it is not convex.
 */
export class ChainCollider2D extends Collider2D {
  /** The points the chain runs through, in the body's local space. */
  points: Vector2[] = [new Vector2(-0.5, 0), new Vector2(0.5, 0)];
  /** Join the last point back to the first. */
  loop = false;

  override toShape(): Shape {
    return new ChainShape(
      this.points.map((p) => new Vec2(p.x, p.y)),
      this.loop,
    );
  }
}
