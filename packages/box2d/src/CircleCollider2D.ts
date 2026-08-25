import { CircleShape, type Shape } from 'planck';
import { Collider2D } from './Collider2D.js';

/** A 2D circle collision shape. */
export class CircleCollider2D extends Collider2D {
  /** Radius. Match it to the visible geometry; a collider never infers one. */
  radius = 0.5;

  override toShape(): Shape {
    return new CircleShape(this.radius);
  }
}
