import { MathUtils, Vector3 } from 'three';

type Vec3 = readonly [number, number, number];

/**
 * A knot, as written in a scene: a bare position — `[0, 0, 10]`, its tangents made smooth from its
 * neighbours (Unity's `AutoSmooth`) — or Unity's `BezierKnot` fields. Tangents are offsets from the
 * position; `tangentIn` points back along the curve. Give one and the other mirrors it.
 *
 * `roll` banks the curve around its direction, in radians: a racing track's banked turn. Unity keeps
 * this in the knot's `rotation`; a roll is the part of it a path needs.
 */
export type BezierKnot = Vec3 | { position: Vec3; tangentIn?: Vec3; tangentOut?: Vec3; roll?: number };

/** Samples per curve for the length table: plenty for a road at 1 m resolution, cheap to build. */
const SAMPLES = 32;
const UP = new Vector3(0, 1, 0);

/**
 * A cubic Bézier spline, in its container's space: Unity's `Spline`. `t` is 0..1 along its length
 * — the same distance between equal steps of `t`, as Unity's `EvaluatePosition` does.
 */
export class Spline {
  readonly closed: boolean;
  /** The positions, and each curve's four control points, resolved from the knots. */
  private readonly controls: Vector3[][] = [];
  private readonly rolls: [number, number][] = [];
  /** Cumulative length at each sample: curve `i`, sample `j` is `[i * SAMPLES + j]`. */
  private readonly lengths: number[] = [0];
  /** The up vector at each sample: the world's up made square to the curve, carried along where the curve is vertical. */
  private readonly ups: Vector3[] = [];

  constructor(knots: readonly BezierKnot[], closed = false) {
    this.closed = closed;
    const points = knots.map((k) => new Vector3(...(Array.isArray(k) ? (k as Vec3) : (k as { position: Vec3 }).position)));
    const count = points.length;
    if (count < 2) return;
    const at = (i: number) => points[closed ? (i + count) % count : MathUtils.clamp(i, 0, count - 1)]!;

    const tangentsOut = knots.map((k, i) => {
      const given = Array.isArray(k) ? undefined : (k as { tangentOut?: Vec3; tangentIn?: Vec3 });
      if (given?.tangentOut) return new Vector3(...given.tangentOut);
      if (given?.tangentIn) return new Vector3(...given.tangentIn).negate();
      return autoSmooth(at(i - 1), at(i), at(i + 1), 'out', !closed && i === count - 1);
    });
    const tangentsIn = knots.map((k, i) => {
      const given = Array.isArray(k) ? undefined : (k as { tangentOut?: Vec3; tangentIn?: Vec3 });
      if (given?.tangentIn) return new Vector3(...given.tangentIn);
      if (given?.tangentOut) return new Vector3(...given.tangentOut).negate();
      return autoSmooth(at(i - 1), at(i), at(i + 1), 'in', !closed && i === 0);
    });
    const roll = (i: number) => {
      const k = knots[closed ? i % count : i];
      return k && !Array.isArray(k) ? ((k as { roll?: number }).roll ?? 0) : 0;
    };

    const curves = closed ? count : count - 1;
    for (let i = 0; i < curves; i++) {
      const p0 = points[i]!;
      const p3 = points[(i + 1) % count]!;
      this.controls.push([p0, p0.clone().add(tangentsOut[i]!), p3.clone().add(tangentsIn[(i + 1) % count]!), p3]);
      this.rolls.push([roll(i), roll(i + 1)]);
    }

    const previous = new Vector3();
    const point = new Vector3();
    const tangent = new Vector3();
    let total = 0;
    for (let i = 0; i < curves; i++) {
      for (let j = 0; j <= SAMPLES; j++) {
        if (i > 0 && j === 0) continue;
        this.curvePoint(i, j / SAMPLES, point);
        if (i > 0 || j > 0) this.lengths.push((total += point.distanceTo(previous)));
        previous.copy(point);
        this.curveTangent(i, j / SAMPLES, tangent);
        const carried = this.ups[this.ups.length - 1];
        this.ups.push(squareUp(tangent, carried));
      }
    }
  }

  /** The length, in the container's units. */
  getLength(): number {
    return this.lengths[this.lengths.length - 1]!;
  }

  /** The point at `t`, 0..1 along the length. */
  evaluatePosition(t: number, target = new Vector3()): Vector3 {
    const [curve, u] = this.locate(t);
    return curve < 0 ? target.set(0, 0, 0) : this.curvePoint(curve, u, target);
  }

  /** The direction at `t`, unit length. */
  evaluateTangent(t: number, target = new Vector3()): Vector3 {
    const [curve, u] = this.locate(t);
    return curve < 0 ? target.set(0, 0, 1) : this.curveTangent(curve, u, target);
  }

  /** The up vector at `t`: square to the tangent, banked by the knots' `roll`. */
  evaluateUpVector(t: number, target = new Vector3()): Vector3 {
    const [curve, u, sample, between] = this.locate(t);
    if (curve < 0) return target.copy(UP);
    const tangent = this.curveTangent(curve, u, new Vector3());
    target.lerpVectors(this.ups[sample]!, this.ups[Math.min(sample + 1, this.ups.length - 1)]!, between);
    target.addScaledVector(tangent, -target.dot(tangent)).normalize();
    const [from, to] = this.rolls[curve]!;
    const roll = MathUtils.lerp(from, to, u * u * (3 - 2 * u));
    return roll ? target.applyAxisAngle(tangent, roll) : target;
  }

  /** `t` at a distance along the spline, clamped to its ends — the inverse of `t * getLength()`. */
  distanceToT(distance: number): number {
    const length = this.getLength();
    return length > 0 ? MathUtils.clamp(distance / length, 0, 1) : 0;
  }

  /** Curve index, the curve's own parameter, and the length-table sample at or before it with the fraction past it. */
  private locate(t: number): [curve: number, u: number, sample: number, between: number] {
    if (this.controls.length === 0) return [-1, 0, 0, 0];
    const lengths = this.lengths;
    const distance = MathUtils.clamp(t, 0, 1) * this.getLength();
    let low = 0;
    let high = lengths.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (lengths[mid]! <= distance) low = mid;
      else high = mid;
    }
    const span = lengths[high]! - lengths[low]!;
    const between = span > 0 ? (distance - lengths[low]!) / span : 0;
    const curve = Math.min(Math.floor(low / SAMPLES), this.controls.length - 1);
    const u = (low - curve * SAMPLES + between) / SAMPLES;
    return [curve, Math.min(u, 1), low, between];
  }

  private curvePoint(curve: number, u: number, target: Vector3): Vector3 {
    const [p0, p1, p2, p3] = this.controls[curve]!;
    const v = 1 - u;
    return target
      .copy(p0!).multiplyScalar(v * v * v)
      .addScaledVector(p1!, 3 * v * v * u)
      .addScaledVector(p2!, 3 * v * u * u)
      .addScaledVector(p3!, u * u * u);
  }

  private curveTangent(curve: number, u: number, target: Vector3): Vector3 {
    const [p0, p1, p2, p3] = this.controls[curve]!;
    const v = 1 - u;
    target
      .subVectors(p1!, p0!).multiplyScalar(3 * v * v)
      .addScaledVector(new Vector3().subVectors(p2!, p1!), 6 * v * u)
      .addScaledVector(new Vector3().subVectors(p3!, p2!), 3 * u * u);
    // A zero-length tangent (a knot with no tangent at the curve's end) reads its direction from the chord.
    if (target.lengthSq() < 1e-12) target.subVectors(p3!, p0!);
    return target.normalize();
  }
}

/** Unity's `AutoSmooth`: along the line through the neighbours, a third of the distance to each. */
function autoSmooth(previous: Vector3, current: Vector3, next: Vector3, side: 'in' | 'out', end: boolean): Vector3 {
  if (end) return new Vector3();
  const direction = new Vector3().subVectors(next, previous).normalize();
  return side === 'out'
    ? direction.multiplyScalar(current.distanceTo(next) / 3)
    : direction.multiplyScalar(-current.distanceTo(previous) / 3);
}

/** The world's up made square to `tangent`; where the curve runs vertical, the last one carried over. */
function squareUp(tangent: Vector3, carried: Vector3 | undefined): Vector3 {
  const reference = Math.abs(tangent.dot(UP)) < 0.99 || !carried ? UP : carried;
  const up = reference.clone().addScaledVector(tangent, -reference.dot(tangent));
  return up.lengthSq() > 1e-12 ? up.normalize() : new Vector3(0, 0, 1);
}

/** Unity's `SplineUtility` — what is not a method of a spline. */
export const SplineUtility = {
  /** The point on `spline` nearest `point`, both in the spline's space, and its `t`. */
  getNearestPoint(spline: Spline, point: Vector3, resolution = 4): { position: Vector3; t: number; distance: number } {
    const steps = Math.max(8, Math.ceil(spline.getLength() * resolution));
    const probe = new Vector3();
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i <= steps; i++) {
      const d = spline.evaluatePosition(i / steps, probe).distanceToSquared(point);
      if (d < bestDistance) [best, bestDistance] = [i / steps, d];
    }
    // Then halve the step around the best sample until it stops moving.
    let step = 1 / steps;
    while (step > 1e-6) {
      step /= 2;
      for (const t of [best - step, best + step]) {
        if (t < 0 || t > 1) continue;
        const d = spline.evaluatePosition(t, probe).distanceToSquared(point);
        if (d < bestDistance) [best, bestDistance] = [t, d];
      }
    }
    const position = spline.evaluatePosition(best);
    return { position, t: best, distance: Math.sqrt(bestDistance) };
  },
};
