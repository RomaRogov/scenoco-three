import { Vector2, Vector3 } from 'three';
import { Collider, type Bounds } from './Collider.js';

/**
 * A flat ground plane, in the XZ plane.
 *
 * Not infinite: a truly infinite plane makes a fallen object impossible to find, and rapier's
 * `<PlaneCollider>` is a thin box for the same reason. The two match.
 */
export class PlaneCollider extends Collider {
  /** Half the plane's extent on X and Z. */
  halfExtents = new Vector2(5, 5);

  private readonly center = new Vector3();
  private readonly scale = new Vector3();
  private readonly half = new Vector3();
  private readonly cached: Bounds = { shape: 'box', center: this.center, half: this.half };

  override worldBounds(): Bounds {
    this.object3D.getWorldPosition(this.center);
    this.object3D.getWorldScale(this.scale);
    this.half.set(
      Math.abs(this.scale.x) * this.halfExtents.x,
      THICKNESS,
      Math.abs(this.scale.z) * this.halfExtents.y,
    );
    return this.cached;
  }
}

/** Thin enough not to be seen, thick enough that nothing tunnels through it. */
const THICKNESS = 0.05;
