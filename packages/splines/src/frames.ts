import { Matrix4, Vector3, type Object3D } from 'three';
import type { SplineContainer } from './SplineContainer.js';

/** A point on the spline and its frame: forward along it, up from it, and right of it, all unit length. */
export interface Frame {
  position: Vector3;
  forward: Vector3;
  up: Vector3;
  right: Vector3;
}

/**
 * Reads a container's spline in another node's space — where a generated mesh or a placed object
 * lives — so a road on one node can follow a spline held by another.
 */
export class FrameReader {
  private readonly toSpace = new Matrix4();
  private readonly container: SplineContainer;

  constructor(container: SplineContainer, space: Object3D | null) {
    this.container = container;
    container.node.updateWorldMatrix(true, false);
    this.toSpace.copy(container.node.matrixWorld);
    if (space) {
      space.updateWorldMatrix(true, false);
      this.toSpace.premultiply(new Matrix4().copy(space.matrixWorld).invert());
    }
  }

  /** The length in the reading space. */
  get length(): number {
    return this.container.spline.getLength() * this.toSpace.getMaxScaleOnAxis();
  }

  at(t: number, frame: Frame = { position: new Vector3(), forward: new Vector3(), up: new Vector3(), right: new Vector3() }): Frame {
    const spline = this.container.spline;
    spline.evaluatePosition(t, frame.position).applyMatrix4(this.toSpace);
    spline.evaluateTangent(t, frame.forward).transformDirection(this.toSpace);
    spline.evaluateUpVector(t, frame.up).transformDirection(this.toSpace);
    // Right-handed, as three.js is: forward × up. Facing -Z with +Y up, right is +X.
    frame.right.crossVectors(frame.forward, frame.up).normalize();
    return frame;
  }
}
