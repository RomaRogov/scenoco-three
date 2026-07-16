import { Quaternion, Vector3 } from 'three';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider, type Bounds } from './Collider.js';

/**
 * A cylinder collision shape along Y (API-identical to rapier's `<CylinderCollider>`).
 * In this detection-only system it is **approximated as a capsule** (its flat caps
 * round out by up to `radius`); use rapier for an exact cylinder.
 */
@component({ name: 'CylinderCollider', description: 'A cylinder collision shape along Y (detection-only; approximated as a capsule)' })
export class CylinderCollider extends Collider {
  @property({ type: ValueType.Float, description: 'Radius' })
  radius = 0.5;
  @property({ type: ValueType.Float, description: 'Half-height (along Y)' })
  halfHeight = 0.5;

  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _dir = new Vector3();
  private readonly _q = new Quaternion();
  private readonly _scale = new Vector3();
  /** Reused per-step bounds — endpoints/radius mutated in place (no per-step allocation). */
  private readonly _bounds = { shape: 'capsule' as const, a: this._a, b: this._b, radius: 0 };

  override worldBounds(): Bounds {
    this.node.getWorldScale(this._scale);
    this.node.getWorldPosition(this._a);
    this._b.copy(this._a);
    this._dir.set(0, this.halfHeight * Math.abs(this._scale.y), 0).applyQuaternion(this.node.getWorldQuaternion(this._q));
    this._a.sub(this._dir);
    this._b.add(this._dir);
    this._bounds.radius = this.radius * Math.max(Math.abs(this._scale.x), Math.abs(this._scale.z));
    return this._bounds;
  }
}
