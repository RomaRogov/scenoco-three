import { Vector3 } from 'three';
import type { Bounds, BoxBounds, CapsuleBounds } from './Collider.js';

/**
 * Overlap tests between world-space bounds. Pure geometry — nothing here knows about
 * components, scenes or the loop, which is what keeps it readable and testable on its own.
 *
 * Every collider reduces to one of two bounds: an axis-aligned box, or a capsule (a segment
 * with a radius, which a sphere is with a zero-length segment). Three tests cover every pair.
 */
export function overlaps(a: Bounds, b: Bounds): boolean {
  if (a.shape === 'box' && b.shape === 'box') return boxBox(a, b);
  if (a.shape === 'capsule' && b.shape === 'capsule') return capsuleCapsule(a, b);
  return a.shape === 'box' ? boxCapsule(a, b as CapsuleBounds) : boxCapsule(b as BoxBounds, a);
}

function boxBox(a: BoxBounds, b: BoxBounds): boolean {
  return (
    Math.abs(a.center.x - b.center.x) <= a.half.x + b.half.x &&
    Math.abs(a.center.y - b.center.y) <= a.half.y + b.half.y &&
    Math.abs(a.center.z - b.center.z) <= a.half.z + b.half.z
  );
}

function capsuleCapsule(a: CapsuleBounds, b: CapsuleBounds): boolean {
  const r = a.radius + b.radius;
  return segSegDistSq(a.a, a.b, b.a, b.b) <= r * r;
}

function boxCapsule(box: BoxBounds, cap: CapsuleBounds): boolean {
  return segAabbDistSq(cap.a, cap.b, box.center, box.half) <= cap.radius * cap.radius;
}

/** Squared distance between two segments (Ericson); handles zero-length (point) segments. */
function segSegDistSq(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  const { d1, d2, r, c1, c2 } = scratch;
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  r.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const EPS = 1e-12;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) return r.dot(r);
  if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceToSquared(c2);
}

/** Squared distance between a segment and an AABB. Point→AABB distance is convex along the segment → ternary search. */
function segAabbDistSq(p: Vector3, q: Vector3, center: Vector3, half: Vector3): number {
  const at = (t: number): number => {
    scratch.p.copy(p).lerp(q, t);
    return sqDistPointAABB(scratch.p, center, half);
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (at(m1) < at(m2)) hi = m2;
    else lo = m1;
  }
  return at((lo + hi) / 2);
}

function sqDistPointAABB(pt: Vector3, center: Vector3, half: Vector3): number {
  const dx = Math.max(0, Math.abs(pt.x - center.x) - half.x);
  const dy = Math.max(0, Math.abs(pt.y - center.y) - half.y);
  const dz = Math.max(0, Math.abs(pt.z - center.z) - half.z);
  return dx * dx + dy * dy + dz * dz;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const scratch = { d1: new Vector3(), d2: new Vector3(), r: new Vector3(), c1: new Vector3(), c2: new Vector3(), p: new Vector3() };
