import type RAPIER from '@dimforge/rapier3d-compat';
import { Component, component, enumOf, property, ValueType } from '@scenoco-three/core';

/** How a body moves — the value matches the Rapier RigidBodyDesc factory. */
export const RigidBodyKind = enumOf('RigidBodyKind', { dynamic: 'dynamic', fixed: 'fixed', kinematic: 'kinematic' });

/**
 * Marks the host node as a Rapier rigid body — plain data the `PhysicsSystem`
 * reconciles into the world (no manual registration). Pair it with one or more
 * `<Collider>` on the same node to give it shape. The system stamps the live
 * `body` onto this component once it's built.
 */
@component({ name: 'RigidBody', description: 'A physics body driven by the Rapier world (needs a <Physics> scene)' })
export class RigidBody extends Component {
  @property({ type: RigidBodyKind, description: 'How the body moves' })
  kind = 'dynamic';
  @property({ type: ValueType.Float, description: 'Damps linear velocity over time' }) linearDamping = 0;
  @property({ type: ValueType.Float, description: 'Damps angular velocity over time' }) angularDamping = 0;
  @property({ type: ValueType.Float, description: 'Multiplier on world gravity for this body' })
  gravityScale = 1;
  @property({
    type: ValueType.Bool,
    description: 'Continuous collision detection — stops fast small bodies (bullets) tunnelling through thin colliders',
  })
  ccd = false;

  /** The live Rapier body, set by the PhysicsSystem after it builds it. */
  body?: RAPIER.RigidBody;

  /** Apply an instantaneous impulse (world space), waking the body. */
  applyImpulse(x: number, y: number, z: number): void {
    this.body?.applyImpulse({ x, y, z }, true);
  }

  /** Set the linear velocity (world space), waking the body. */
  setLinvel(x: number, y: number, z: number): void {
    this.body?.setLinvel({ x, y, z }, true);
  }
}
