import { Vector3 } from 'three';
import { Collider, type Bounds } from './Collider.js';

/** A sphere collision shape. */
export class SphereCollider extends Collider {
  /**
   * Radius. Match it to the visible geometry; a collider never infers one.
   *
   * In the node's own units, before its scale — the same as `BoxCollider.halfExtents`, and scaled with the node exactly as the mesh beside it is.
   */
  radius = 0.5;

  private readonly center = new Vector3();
  private readonly scale = new Vector3();
  // A sphere is a capsule whose segment has zero length, so one overlap test covers both.
  private readonly cached = { shape: 'capsule' as const, a: this.center, b: this.center, radius: 0.5 };

  override worldBounds(): Bounds {
    this.object3D.getWorldPosition(this.center);
    this.object3D.getWorldScale(this.scale);
    // A sphere stays a sphere under non-uniform scale, so the largest axis wins.
    const largest = Math.max(Math.abs(this.scale.x), Math.abs(this.scale.y), Math.abs(this.scale.z));
    this.cached.radius = this.radius * largest;
    return this.cached;
  }
}
