import { Vector3 } from 'three';
import { Collider, type Bounds } from './Collider.js';

/** A box collision shape. Axis-aligned — its node's rotation is ignored. */
export class BoxCollider extends Collider {
  /**
   * Half the box's size — half the *visible* size, if it is meant to match the mesh.
   *
   * A collider never infers its size from the geometry beside it. The two are separate assets,
   * and a collider that guessed would be wrong the moment either changed.
   */
  halfExtents = new Vector3(0.5, 0.5, 0.5);

  // Reused every frame: `worldBounds` runs per collider per frame, and fresh vectors each time
  // is allocation the loop does not need.
  private readonly center = new Vector3();
  private readonly half = new Vector3();
  private readonly cached: Bounds = { shape: 'box', center: this.center, half: this.half };

  override worldBounds(): Bounds {
    this.object3D.getWorldPosition(this.center);
    this.object3D.getWorldScale(this.half);
    this.half.set(
      Math.abs(this.half.x) * this.halfExtents.x,
      Math.abs(this.half.y) * this.halfExtents.y,
      Math.abs(this.half.z) * this.halfExtents.z,
    );
    return this.cached;
  }
}
