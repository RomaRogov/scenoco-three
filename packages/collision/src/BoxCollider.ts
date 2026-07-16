import { Vector3 } from 'three';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider, type Bounds } from './Collider.js';

/** A box collision shape (API-identical to rapier's `<BoxCollider>`). Axis-aligned (rotation ignored). */
@component({ name: 'BoxCollider', description: 'A box (cuboid) collision shape (detection-only)' })
export class BoxCollider extends Collider {
  @property({ type: ValueType.Vec3, default: [0.5, 0.5, 0.5], description: 'Half-extents (x, y, z)' })
  halfExtents = new Vector3(0.5, 0.5, 0.5);

  private readonly _center = new Vector3();
  private readonly _half = new Vector3();
  /** Reused per-step bounds — its center/half are the vectors above, mutated in place (no per-step allocation). */
  private readonly _bounds = { shape: 'box' as const, center: this._center, half: this._half };

  override worldBounds(): Bounds {
    this.node.getWorldPosition(this._center);
    this.node.getWorldScale(this._half);
    this._half.set(
      Math.abs(this._half.x) * this.halfExtents.x,
      Math.abs(this._half.y) * this.halfExtents.y,
      Math.abs(this._half.z) * this.halfExtents.z,
    );
    return this._bounds;
  }
}
