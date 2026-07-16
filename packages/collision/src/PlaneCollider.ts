import { Vector2, Vector3 } from 'three';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider, type Bounds } from './Collider.js';

/** A plane trigger is a thin box in the XZ plane (matches rapier's PlaneCollider, a thin cuboid). */
const THICKNESS = 0.001;

/**
 * A flat XZ collision shape — a thin box (API-identical to rapier's
 * `<PlaneCollider>`, which is also a thin cuboid, not an infinite half-space).
 */
@component({ name: 'PlaneCollider', description: 'A flat XZ ground collision shape (thin cuboid; detection-only)' })
export class PlaneCollider extends Collider {
  @property({ type: ValueType.Vec2, default: [5, 5], description: 'Half-extents in X and Z' })
  halfExtents = new Vector2(5, 5);

  private readonly _center = new Vector3();
  private readonly _half = new Vector3();
  private readonly _scale = new Vector3();
  /** Reused per-step bounds — center/half mutated in place (no per-step allocation). */
  private readonly _bounds = { shape: 'box' as const, center: this._center, half: this._half };

  override worldBounds(): Bounds {
    this.node.getWorldPosition(this._center);
    this.node.getWorldScale(this._scale);
    this._half.set(Math.abs(this._scale.x) * this.halfExtents.x, THICKNESS, Math.abs(this._scale.z) * this.halfExtents.y);
    return this._bounds;
  }
}
