import { BoxShape, type Shape } from 'planck';
import { Vector2, type Box3 } from 'three';
import { Collider2D } from './Collider2D.js';
import { placePoint, type ShapeFrame } from './transform.js';

/** Unity's `BoxCollider2D`: a rectangle `size` wide and high — full size, not half. Left out, the mesh's. */
export class BoxCollider2D extends Collider2D {
  size = new Vector2(1, 1);

  protected override fit(bounds: Box3, written: ReadonlySet<string>): void {
    if (written.has('size')) return;
    this.size.set(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
    this.fitOffset(bounds, written);
  }

  shapes(frame: ShapeFrame): Shape[] {
    const centre = placePoint(frame, this.offset.x, this.offset.y);
    return [new BoxShape(Math.abs((this.size.x * frame.scaleX) / 2), Math.abs((this.size.y * frame.scaleY) / 2), centre, frame.angle)];
  }
}
