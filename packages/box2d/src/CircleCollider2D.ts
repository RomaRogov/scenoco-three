import { CircleShape, type Shape } from 'planck';
import type { Box3 } from 'three';
import { Collider2D } from './Collider2D.js';
import { placePoint, type ShapeFrame } from './transform.js';

/** Unity's `CircleCollider2D`. Left out, the radius is half the mesh's wider side. */
export class CircleCollider2D extends Collider2D {
  radius = 0.5;

  protected override fit(bounds: Box3, written: ReadonlySet<string>): void {
    if (written.has('radius')) return;
    this.radius = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) / 2;
    this.fitOffset(bounds, written);
  }

  shapes(frame: ShapeFrame): Shape[] {
    // Scaled by the larger axis, as Unity scales it: a circle stays a circle.
    return [new CircleShape(placePoint(frame, this.offset.x, this.offset.y), this.radius * Math.max(Math.abs(frame.scaleX), Math.abs(frame.scaleY)))];
  }
}
