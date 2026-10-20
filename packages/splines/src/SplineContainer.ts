import { Object3D, Vector3 } from 'three';
import { Behaviour } from '@scenoco-three/core';
import { Spline, type BezierKnot } from './Spline.js';

/**
 * Holds a spline on its node — Unity's `SplineContainer`. The knots are in the node's space; what it
 * evaluates is in the world's.
 *
 * ```tsx
 * <Group>
 *   <SplineContainer closed knots={[[0, 0, 0], [40, 0, 10], { position: [60, 2, 50], roll: 0.2 }, [0, 0, 60]]} />
 * </Group>
 * ```
 */
export class SplineContainer extends Behaviour {
  /** The knots, in order. Assign a new array to change the shape; the spline is rebuilt on next use. */
  knots: BezierKnot[] = [];
  /** The last knot joins back to the first. */
  closed = false;

  private built: Spline | null = null;
  private builtFrom: [BezierKnot[], boolean] | null = null;

  /** The spline, in this node's space — Unity's `Spline`. */
  get spline(): Spline {
    if (!this.built || this.builtFrom?.[0] !== this.knots || this.builtFrom[1] !== this.closed) {
      this.built = new Spline(this.knots, this.closed);
      this.builtFrom = [this.knots, this.closed];
    }
    return this.built;
  }

  /** The point at `t`, 0..1 along the length, in world space. */
  evaluatePosition(t: number, target = new Vector3()): Vector3 {
    return this.spline.evaluatePosition(t, target).applyMatrix4(this.world());
  }

  /** The direction at `t`, in world space, unit length. */
  evaluateTangent(t: number, target = new Vector3()): Vector3 {
    return this.spline.evaluateTangent(t, target).transformDirection(this.world());
  }

  /** The up vector at `t`, in world space, unit length. */
  evaluateUpVector(t: number, target = new Vector3()): Vector3 {
    return this.spline.evaluateUpVector(t, target).transformDirection(this.world());
  }

  /** The length in world units: the spline's own length, scaled with its node. */
  calculateLength(): number {
    return this.spline.getLength() * this.world().getMaxScaleOnAxis();
  }

  private world() {
    this.node.updateWorldMatrix(true, false);
    return this.node.matrixWorld;
  }
}

/**
 * The container a spline component works on: the one it was given — a node, which is searched for
 * its `SplineContainer` the way Unity takes a GameObject dropped on the field — or its own node's.
 */
export function containerFor(owner: Behaviour, given: SplineContainer | Object3D | null, who: string): SplineContainer {
  const found = given instanceof Object3D ? given.getComponent(SplineContainer) : (given ?? owner.getComponent(SplineContainer));
  if (!found) {
    throw new Error(
      `${who} has no spline: give it container={track}, a ref to the node holding the <SplineContainer>, ` +
        'or put a <SplineContainer> on its own node.',
    );
  }
  return found;
}
