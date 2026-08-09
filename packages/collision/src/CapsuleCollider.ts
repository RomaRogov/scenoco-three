import { Quaternion, Vector3 } from 'three';
import { component, property, ValueType } from '@scenoco-three/core';
import { Collider, type Bounds } from './Collider.js';

/** A capsule collision shape along Y (API-identical to rapier's `<CapsuleCollider>`). */
@component({ name: 'CapsuleCollider', description: 'A capsule collision shape, axis-aligned along Y (detection-only)' })
export class CapsuleCollider extends Collider {
  @property({ type: ValueType.Float, required: true, description: 'Radius of the hemispherical caps — match the visible geometry; a collider never infers size from geometry' })
  radius = 0.5;
  @property({ type: ValueType.Float, required: true, description: 'Half the distance between the cap centers (along Y)' })
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
    // Segment along the node's world Y axis, ± halfHeight.
    this._dir.set(0, this.halfHeight * Math.abs(this._scale.y), 0).applyQuaternion(this.node.getWorldQuaternion(this._q));
    this._a.sub(this._dir);
    this._b.add(this._dir);
    this._bounds.radius = this.radius * Math.max(Math.abs(this._scale.x), Math.abs(this._scale.z));
    return this._bounds;
  }
}
