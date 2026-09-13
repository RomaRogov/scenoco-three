import { Quaternion, Vector3 } from 'three';
import { Collider, type Bounds } from './Collider.js';

/** A cylinder collision shape. Its long axis is Y, and it is treated as a capsule for overlap — close enough for detection, and exactly what rapier’s own broad phase does. */
export class CylinderCollider extends Collider {
  /**
   * Radius.
   *
   * In the node's own units, before its scale — the same as `BoxCollider.halfExtents`, and scaled with the node exactly as the mesh beside it is.
   */
  radius = 0.5;
  /** Half the cylinder’s height. */
  halfHeight = 0.5;

  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly axis = new Vector3();
  private readonly scale = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly cached = { shape: 'capsule' as const, a: this.a, b: this.b, radius: 0.5 };

  override worldBounds(): Bounds {
    this.object3D.getWorldScale(this.scale);
    this.object3D.getWorldPosition(this.a);
    this.b.copy(this.a);
    // The segment runs along the node's world Y, half the straight length each way.
    this.axis
      .set(0, this.halfHeight * Math.abs(this.scale.y), 0)
      .applyQuaternion(this.object3D.getWorldQuaternion(this.rotation));
    this.a.sub(this.axis);
    this.b.add(this.axis);
    this.cached.radius = this.radius * Math.max(Math.abs(this.scale.x), Math.abs(this.scale.z));
    return this.cached;
  }
}
