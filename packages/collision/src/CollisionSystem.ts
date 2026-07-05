import { Vector3, type Object3D } from 'three';
import { System, system } from '@scenoco-three/core';
import { Collider, type Bounds, type ContactHandlers } from './Collider.js';

/**
 * The detection-only collision world: registered for `Collider`, it runs while
 * the scene holds any collider and keeps `this.components` in sync. Each frame it
 * recomputes every collider's world bounds, tests all pairs (O(n²)), and — the
 * frame an overlap begins or ends — dispatches the **same contact hooks rapier
 * does**: `onCollisionEnter`/`onCollisionExit` for solid pairs, or
 * `onTriggerEnter`/`onTriggerExit` when either collider is a sensor. Each hook
 * receives the other node, so behaviour code moves between engines unchanged.
 *
 * No bodies, forces, or resolution — for real physics use `@scenoco-three/rapier`.
 */
@system(Collider)
export class CollisionSystem extends System<Collider> {
  // Pairs overlapping this/last frame: numeric key → the two colliders, so exits
  // can be dispatched. Double-buffered — `prev`/`cur` (and their tuple pools) are
  // swapped each step and the reused one cleared, so a steady state allocates
  // nothing here (no `new Map`, no fresh `[a, b]` tuple, no string key per pair).
  private prev = new Map<number, [Collider, Collider]>();
  private cur = new Map<number, [Collider, Collider]>();
  private prevPool: [Collider, Collider][] = [];
  private curPool: [Collider, Collider][] = [];
  private curUsed = 0;
  /** Reused world-bounds buffer, index-aligned with `this.components` (length reset each step). */
  private readonly bounds: Bounds[] = [];
  private readonly id = new WeakMap<Collider, number>();
  private nextId = 1;

  override step(): void {
    const list = this.components;
    const n = list.length;
    if (n === 0) {
      if (this.prev.size > 0) this.prev.clear();
      return;
    }
    this.engine.scene.updateMatrixWorld();
    const bounds = this.bounds;
    bounds.length = n; // reuse capacity; each collider fills its own reused Bounds
    for (let i = 0; i < n; i++) bounds[i] = list[i]!.worldBounds();

    const cur = this.cur;
    cur.clear();
    this.curUsed = 0;
    for (let i = 0; i < n; i++) {
      const a = list[i]!;
      if (a._destroyed) continue; // enqueued for destruction this tick — treat as gone
      for (let j = i + 1; j < n; j++) {
        const b = list[j]!;
        if (b._destroyed) continue;
        if (a.node === b.node) continue; // colliders on the same node don't self-collide
        if (!overlaps(bounds[i]!, bounds[j]!)) continue;
        const key = this.pairKey(a, b);
        cur.set(key, this.borrow(a, b));
        if (!this.prev.has(key)) emit(a, b, 'enter');
      }
    }
    for (const [key, [a, b]] of this.prev) {
      if (!cur.has(key)) emit(a, b, 'exit');
    }
    // Swap maps + their pools together: the just-built `cur` becomes next step's
    // `prev` (still referencing curPool), and the old `prev` becomes the reusable
    // `cur`. Swapping the pools in lockstep means next step's `borrow` overwrites
    // only the pool the new `prev` does NOT reference — its exit-pass tuples stay live.
    const oldPrev = this.prev;
    this.prev = cur;
    this.cur = oldPrev;
    const tmpPool = this.prevPool;
    this.prevPool = this.curPool;
    this.curPool = tmpPool;
  }

  override onDetach(): void {
    this.prev.clear();
    this.cur.clear();
  }

  /** A pooled `[a, b]` tuple from the current pool — grown once, reused thereafter. */
  private borrow(a: Collider, b: Collider): [Collider, Collider] {
    let t = this.curPool[this.curUsed];
    if (t) { t[0] = a; t[1] = b; } else this.curPool[this.curUsed] = t = [a, b];
    this.curUsed++;
    return t;
  }

  private pairKey(a: Collider, b: Collider): number {
    const ia = this.idOf(a);
    const ib = this.idOf(b);
    // Pack the two small collider ids into one number (unordered). PAIR_BASE bounds
    // the number of distinct colliders per session at 2**26 (~67M) before keys
    // could alias — comfortably beyond any real play session.
    return ia < ib ? ia * PAIR_BASE + ib : ib * PAIR_BASE + ia;
  }

  private idOf(c: Collider): number {
    let n = this.id.get(c);
    if (n === undefined) this.id.set(c, (n = this.nextId++));
    return n;
  }
}

/** Base for packing two collider ids into one numeric pair key (see `pairKey`). */
const PAIR_BASE = 2 ** 26;

/** Deliver contact hooks to both colliders' nodes (swapping self/other), rapier-style. */
function emit(a: Collider, b: Collider, phase: 'enter' | 'exit'): void {
  const sensor = a.isSensor || b.isSensor;
  dispatch(a, b.node, sensor, phase);
  dispatch(b, a.node, sensor, phase);
}

function dispatch(self: Collider, other: Object3D, sensor: boolean, phase: 'enter' | 'exit'): void {
  // A destroyed collider's node has no components left → getComponents returns [],
  // so exits still reach the surviving collider without touching the removed one.
  for (const c of self.engine.getComponents(self.node)) {
    if (c._destroyed) continue; // don't fire hooks on a component already torn down this tick
    const h = c as unknown as ContactHandlers;
    const fn = sensor
      ? phase === 'enter'
        ? h.onTriggerEnter
        : h.onTriggerExit
      : phase === 'enter'
        ? h.onCollisionEnter
        : h.onCollisionExit;
    fn?.call(c, other);
  }
}

// ---- overlap tests (box AABB · capsule swept-sphere) -------------------------

type BoxBounds = Extract<Bounds, { shape: 'box' }>;
type CapsuleBounds = Extract<Bounds, { shape: 'capsule' }>;

const scratch = { d1: new Vector3(), d2: new Vector3(), r: new Vector3(), c1: new Vector3(), c2: new Vector3(), p: new Vector3() };

function overlaps(a: Bounds, b: Bounds): boolean {
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
