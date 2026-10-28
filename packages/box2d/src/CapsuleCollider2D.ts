import { PolygonShape, type Shape } from 'planck';
import { Vector2, type Box3 } from 'three';
import { Collider2D } from './Collider2D.js';
import { placePoint, type ShapeFrame } from './transform.js';

/** Which way a capsule's long axis runs — Unity's `CapsuleDirection2D`. */
export const CapsuleDirection2D = {
  Vertical: 0,
  Horizontal: 1,
} as const;
export type CapsuleDirection2D = (typeof CapsuleDirection2D)[keyof typeof CapsuleDirection2D];

/**
 * Unity's `CapsuleCollider2D`: the box `size` with round ends along `direction`. Box2D has no
 * capsule, so it is a stadium-shaped polygon, as every Box2D engine makes one. Left out, the mesh's size.
 */
export class CapsuleCollider2D extends Collider2D {
  size = new Vector2(0.5, 1);
  direction: CapsuleDirection2D = CapsuleDirection2D.Vertical;

  protected override fit(bounds: Box3, written: ReadonlySet<string>): void {
    if (written.has('size')) return;
    this.size.set(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
    this.fitOffset(bounds, written);
  }

  shapes(frame: ShapeFrame): Shape[] {
    const width = Math.abs(this.size.x * frame.scaleX);
    const height = Math.abs(this.size.y * frame.scaleY);
    const vertical = this.direction === CapsuleDirection2D.Vertical;
    // Built in the frame's turn but at its scale already, so the caps stay round.
    const unscaled = { ...frame, scaleX: 1, scaleY: 1 };
    const centre = placePoint(frame, this.offset.x, this.offset.y);
    const at = { ...unscaled, x: centre.x, y: centre.y };
    return [new PolygonShape(stadium(width, height, vertical).map(([x, y]) => placePoint(at, x, y)))];
  }
}

/** The stadium inscribed in a `width × height` box: round caps at the ends of the long axis. Twelve points, planck's most. */
function stadium(width: number, height: number, vertical: boolean): [number, number][] {
  const SEGMENTS = 5;
  const [along, across] = vertical ? [height, width] : [width, height];
  const radius = across / 2;
  const straight = Math.max(0, along / 2 - radius);
  const points: [number, number][] = [];
  const push = (x: number, y: number) => points.push(vertical ? [x, y] : [y, -x]);
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = (Math.PI * i) / SEGMENTS;
    push(Math.cos(angle) * radius, straight + Math.sin(angle) * radius);
  }
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = Math.PI + (Math.PI * i) / SEGMENTS;
    push(Math.cos(angle) * radius, -straight + Math.sin(angle) * radius);
  }
  return points;
}
