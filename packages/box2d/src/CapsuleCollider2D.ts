import { PolygonShape, Vec2, type Shape } from 'planck';
import { Vector2 } from 'three';
import { Collider2D } from './Collider2D.js';

/** A 2D capsule's long axis, as Unity's `CapsuleDirection2D` names it. */
export type CapsuleDirection2D = 'vertical' | 'horizontal';

/**
 * A 2D capsule collision shape.
 *
 * Box2D has no capsule primitive, so this is a convex **stadium** polygon — a rectangle with
 * semicircular caps — which is the approximation every Box2D-based engine uses. Mirrors Unity's
 * `CapsuleCollider2D`: a `size` box with rounded ends along `direction`.
 */
export class CapsuleCollider2D extends Collider2D {
  /** The box the capsule is inscribed in. */
  size = new Vector2(0.5, 1);
  /** Which way the long axis runs. */
  direction: CapsuleDirection2D = 'vertical';

  override toShape(): Shape {
    return new PolygonShape(stadium(this.size.x, this.size.y, this.direction === 'vertical'));
  }
}

/**
 * The stadium outline inscribed in a `width × height` box: caps of radius `across / 2` at each
 * end of the long axis. Twelve vertices, which is planck's maximum for a polygon.
 */
function stadium(width: number, height: number, vertical: boolean): Vec2[] {
  const SEGMENTS = 5;
  const [along, across] = vertical ? [height, width] : [width, height];
  const radius = across / 2;
  const halfStraight = Math.max(0, along / 2 - radius);
  const points: Vec2[] = [];
  // Built in a vertical frame — long axis on y — and swapped for the horizontal case.
  const push = (x: number, y: number): number =>
    points.push(vertical ? new Vec2(x, y) : new Vec2(y, x));

  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = (Math.PI * i) / SEGMENTS; // top cap, 0 → π
    push(Math.cos(angle) * radius, halfStraight + Math.sin(angle) * radius);
  }
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = Math.PI + (Math.PI * i) / SEGMENTS; // bottom cap, π → 2π
    push(Math.cos(angle) * radius, -halfStraight + Math.sin(angle) * radius);
  }
  return points;
}
