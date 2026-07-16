import { Component, component, enumOf, property, ValueType } from '@scenoco-three/core';

/** How a body moves — mirrors rapier's `RigidBodyKind` (inert here). */
export const RigidBodyKind = enumOf('RigidBodyKind', { dynamic: 'dynamic', fixed: 'fixed', kinematic: 'kinematic' });

/**
 * A rigid body — **inert in this detection-only system**, provided only so a scene
 * authored for `@scenoco-three/rapier` (`<RigidBody>` + colliders) drops in
 * unchanged. Its attributes and imperative methods match rapier's, but nothing
 * moves: there is no simulation here. Colliders detect overlaps with or without a
 * RigidBody on the node — move nodes yourself (or with your own components).
 */
@component({ name: 'RigidBody', description: 'A physics body — inert in detection-only mode (rapier-compatible tag)' })
export class RigidBody extends Component {
  @property({ type: RigidBodyKind, description: 'How the body moves (inert here)' })
  kind = 'dynamic';
  @property({ type: ValueType.Float, description: 'Damps linear velocity over time (inert here)' }) linearDamping = 0;
  @property({ type: ValueType.Float, description: 'Damps angular velocity over time (inert here)' }) angularDamping = 0;
  @property({ type: ValueType.Float, description: 'Multiplier on world gravity for this body (inert here)' })
  gravityScale = 1;
  @property({ type: ValueType.Bool, description: 'Continuous collision detection (inert here)' }) ccd = false;

  /** No live simulation body in detection-only mode. */
  readonly body = undefined;

  /** No-op (no dynamics) — present for rapier API compatibility. */
  applyImpulse(_x: number, _y: number, _z: number): void {}
  /** No-op (no dynamics) — present for rapier API compatibility. */
  setLinvel(_x: number, _y: number, _z: number): void {}
}
