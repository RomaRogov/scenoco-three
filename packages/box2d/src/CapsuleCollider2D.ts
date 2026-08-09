import { PolygonShape, Vec2, type Shape } from 'planck';
import { component, enumOf, property, ValueType } from '@scenoco-three/core';
import { Collider2D } from './Collider2D.js';

/** A 2D capsule's long axis (Unity `CapsuleDirection2D`). */
export const CapsuleDirection2D = enumOf('CapsuleDirection2D', { vertical: 'vertical', horizontal: 'horizontal' });

/**
 * A 2D capsule collision shape. planck (like Box2D) has no capsule primitive, so
 * it is built as a **convex polygon stadium** (a rectangle with semicircular caps)
 * — the same approximation Box2D-based engines use. Mirrors Unity's
 * `CapsuleCollider2D`: a `size` box with rounded ends along `direction`.
 */
@component({ name: 'CapsuleCollider2D', description: 'A 2D capsule collision shape (planck; convex-polygon stadium).' })
export class CapsuleCollider2D extends Collider2D {
  @property({ type: ValueType.Vec2, required: true, description: 'Size (width, height) — the full visible size; a collider never infers size from geometry' })
  size = [0.5, 1];

  @property({ type: CapsuleDirection2D, description: 'Long axis of the capsule' })
  direction = 'vertical';

  toShape(): Shape {
    return new PolygonShape(capsuleVertices(this.size[0]!, this.size[1]!, this.direction === 'vertical'));
  }
}

/**
 * Stadium outline inscribed in the `width × height` box: caps of radius
 * `across/2` along the long axis. 2×(SEGMENTS+1) = 12 vertices — planck's max.
 */
function capsuleVertices(width: number, height: number, vertical: boolean): Vec2[] {
  const SEGMENTS = 5;
  const [along, across] = vertical ? [height, width] : [width, height];
  const r = across / 2;
  const halfStraight = Math.max(0, along / 2 - r);
  const pts: Vec2[] = [];
  // `push` builds in a vertical frame (long axis = y), swapping to x for horizontal.
  const push = (x: number, y: number) => pts.push(vertical ? new Vec2(x, y) : new Vec2(y, x));
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (Math.PI * i) / SEGMENTS; // top cap: 0 → π
    push(Math.cos(a) * r, halfStraight + Math.sin(a) * r);
  }
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = Math.PI + (Math.PI * i) / SEGMENTS; // bottom cap: π → 2π
    push(Math.cos(a) * r, -halfStraight + Math.sin(a) * r);
  }
  return pts;
}
