import { Vector3, type Object3D } from 'three';
import { Behaviour, findObjectOfType } from '@scenoco-three/core';
import { SplineContainer, SplineUtility } from '@scenoco-three/splines';

/**
 * Where its node is on the track: how far along it (`t`, 0..1, and `laps` completed), how far from
 * the centre line (`offset`, + to the left of the way the track runs), and the track's direction and
 * left there. The car's physics reads it for the road's height and grip, its driver to steer, the race
 * for the standings.
 *
 * The first reading searches the whole spline; every one after that only near the last, as a car
 * moves less than a metre a step — a whole-track search for every car every step would cost a
 * thousand samples each.
 */
export class TrackPosition extends Behaviour<Object3D> {
  /** 0..1 along the track, from its first knot. */
  t = 0;
  /** Laps completed: `t` wrapping from the end back to the start. */
  laps = 0;
  /** Signed distance from the centre line, in metres: + to the left of travel. */
  offset = 0;
  /** The road surface's height here: the spline's, which is the asphalt's. */
  height = 0;
  /** The track's direction and its left, where the node is. */
  readonly tangent = new Vector3(0, 0, 1);
  readonly left = new Vector3(1, 0, 0);

  private track: SplineContainer | null = null;
  private length = 1;
  private readonly here = new Vector3();
  private readonly point = new Vector3();

  override start(): void {
    this.track = findObjectOfType(SplineContainer);
    if (!this.track) return;
    this.length = this.track.calculateLength();
    const local = this.track.node.worldToLocal(this.node.getWorldPosition(this.here));
    this.t = SplineUtility.getNearestPoint(this.track.spline, local).t;
    this.measure();
  }

  override fixedUpdate(): void {
    if (!this.track) return;
    this.node.getWorldPosition(this.here);
    // Nine samples a step's reach each way, then halve around the best until it settles.
    const reach = 2 / this.length;
    let best = this.t;
    let bestD = Infinity;
    for (let i = -4; i <= 4; i++) {
      const t = this.t + (reach * i) / 4;
      const d = this.track.evaluatePosition(wrap(t), this.point).distanceToSquared(this.here);
      if (d < bestD) [best, bestD] = [t, d];
    }
    for (let step = reach / 8; step > 1e-6; step /= 2) {
      for (const t of [best - step, best + step]) {
        const d = this.track.evaluatePosition(wrap(t), this.point).distanceToSquared(this.here);
        if (d < bestD) [best, bestD] = [t, d];
      }
    }
    if (best >= 1) this.laps += 1;
    else if (best < 0) this.laps -= 1;
    this.t = wrap(best);
    this.measure();
  }

  /** Progress as one number, laps and all: what the standings sort by. */
  get progress(): number {
    return this.laps + this.t;
  }

  /** The track's length in metres. */
  get trackLength(): number {
    return this.length;
  }

  /** A point `metres` further along the track from here, `side` metres to the left of its centre. */
  ahead(metres: number, side: number, target = new Vector3()): Vector3 {
    if (!this.track) return target.copy(this.here);
    const t = wrap(this.t + metres / this.length);
    this.track.evaluatePosition(t, target);
    const tangent = this.track.evaluateTangent(t, this.point);
    // Left of travel: up × forward.
    return target.addScaledVector(tangent.set(tangent.z, 0, -tangent.x).normalize(), side);
  }

  /** The track's direction `metres` ahead. */
  directionAhead(metres: number, target = new Vector3()): Vector3 {
    return this.track ? this.track.evaluateTangent(wrap(this.t + metres / this.length), target) : target.set(0, 0, 1);
  }

  private measure(): void {
    if (!this.track) return;
    const centre = this.track.evaluatePosition(this.t, this.point);
    this.height = centre.y;
    this.track.evaluateTangent(this.t, this.tangent);
    this.left.set(this.tangent.z, 0, -this.tangent.x).normalize();
    this.offset = this.here.sub(centre).dot(this.left);
  }
}

function wrap(t: number): number {
  return t - Math.floor(t);
}
