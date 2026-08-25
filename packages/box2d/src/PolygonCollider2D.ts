import { PolygonShape, Vec2, type Shape } from 'planck';
import { Vector2 } from 'three';
import { Collider2D } from './Collider2D.js';

/** A 2D convex polygon. The points must be convex and wound counter-clockwise. */
export class PolygonCollider2D extends Collider2D {
  /** The outline, in the body's local space. */
  points: Vector2[] = [
    new Vector2(-0.5, -0.5),
    new Vector2(0.5, -0.5),
    new Vector2(0.5, 0.5),
    new Vector2(-0.5, 0.5),
  ];

  override toShape(): Shape {
    return new PolygonShape(this.points.map((p) => new Vec2(p.x, p.y)));
  }
}
