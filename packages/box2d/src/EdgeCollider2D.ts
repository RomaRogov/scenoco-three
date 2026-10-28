import { ChainShape, EdgeShape, type Shape } from 'planck';
import { Vector2 } from 'three';
import { Collider2D } from './Collider2D.js';
import { placePoint, type ShapeFrame } from './transform.js';

/**
 * Unity's `EdgeCollider2D`: a line through `points` — ground, a track, an outline a polygon cannot
 * be. It has no inside: what is on either side collides with it.
 */
export class EdgeCollider2D extends Collider2D {
  points: Vector2[] = [new Vector2(-0.5, 0), new Vector2(0.5, 0)];

  shapes(frame: ShapeFrame): Shape[] {
    if (this.points.length < 2) throw new Error(`EdgeCollider2D on "${this.node.name}" needs at least two points.`);
    const placed = this.points.map((p) => placePoint(frame, p.x + this.offset.x, p.y + this.offset.y));
    return [placed.length === 2 ? new EdgeShape(placed[0]!, placed[1]!) : new ChainShape(placed, false)];
  }
}
