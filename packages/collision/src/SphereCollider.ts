import { Vector3 } from 'three';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider, type Bounds } from './Collider.js';

/** A sphere collision shape (API-identical to rapier's `<SphereCollider>`) — a zero-length capsule internally. */
@component({ name: 'SphereCollider', description: 'A sphere collision shape (detection-only)' })
export class SphereCollider extends Collider {
  @property({ type: ValueType.Float, description: 'Radius' })
  radius = 0.5;

  private readonly _center = new Vector3();
  private readonly _scale = new Vector3();
  /** Reused per-step bounds — a zero-length capsule at the (mutated) center; only radius changes. */
  private readonly _bounds = { shape: 'capsule' as const, a: this._center, b: this._center, radius: 0 };

  override worldBounds(): Bounds {
    this.node.getWorldPosition(this._center);
    this.node.getWorldScale(this._scale);
    const s = Math.max(Math.abs(this._scale.x), Math.abs(this._scale.y), Math.abs(this._scale.z));
    this._bounds.radius = this.radius * s;
    return this._bounds;
  }
}
