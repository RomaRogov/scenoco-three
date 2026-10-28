import { PolygonShape, Settings, type Shape } from 'planck';
import { ShapeUtils, Vector2 } from 'three';
import { Collider2D } from './Collider2D.js';
import { placePoint, type ShapeFrame } from './transform.js';

/**
 * Unity's `PolygonCollider2D`: the outline through `points`, in order, convex or not. Box2D takes
 * only small convex polygons, so a concave or many-sided outline is cut into triangles — one
 * fixture each, one collider to everything that touches it.
 */
export class PolygonCollider2D extends Collider2D {
  points: Vector2[] = [new Vector2(-0.5, -0.5), new Vector2(0.5, -0.5), new Vector2(0.5, 0.5), new Vector2(-0.5, 0.5)];

  shapes(frame: ShapeFrame): Shape[] {
    if (this.points.length < 3) throw new Error(`PolygonCollider2D on "${this.node.name}" needs at least three points.`);
    const outline = this.points.map((p) => new Vector2(p.x + this.offset.x, p.y + this.offset.y));
    // planck wants counter-clockwise; Unity takes either.
    if (ShapeUtils.isClockWise(outline)) outline.reverse();
    const place = (p: Vector2) => placePoint(frame, p.x, p.y);
    if (outline.length <= Settings.maxPolygonVertices && convex(outline)) return [new PolygonShape(outline.map(place))];
    return ShapeUtils.triangulateShape(outline, []).map((triangle) => new PolygonShape(triangle.map((i) => place(outline[i]!))));
  }
}

/** Whether a counter-clockwise outline turns left at every corner. */
function convex(points: Vector2[]): boolean {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const c = points[(i + 2) % points.length]!;
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < 0) return false;
  }
  return true;
}
