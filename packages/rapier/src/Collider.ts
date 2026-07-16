import RAPIER from '@dimforge/rapier3d-compat';
import { Component, property, ValueType } from '@scenoco-three/core';

/**
 * Shared base for the Rapier collision shapes, mirroring how each light is its
 * own tag: the concrete shapes — `<BoxCollider>`, `<SphereCollider>`,
 * `<CylinderCollider>`, `<PlaneCollider>` — subclass this and implement
 * `shapeDesc()`. The `PhysicsSystem` attaches every `Collider` on a node to that
 * node's `<RigidBody>` (no manual registration).
 *
 * This base is **abstract** and registers no tag of its own; it only carries the
 * shared material properties applied by `toDesc()`.
 */
export abstract class Collider extends Component {
  @property({ type: ValueType.Float, default: 0, description: 'Bounciness 0..1' }) restitution = 0;
  @property({ type: ValueType.Float, default: 0.5, description: 'Friction 0..1' }) friction = 0.5;
  @property({ type: ValueType.Float, default: 1, description: 'Density (kg/m³)' }) density = 1;
  @property({ type: ValueType.Bool, default: false, description: 'A trigger: reports overlaps, no collision response' })
  isSensor = false;

  /** The Rapier shape descriptor for this collider. */
  abstract shapeDesc(): RAPIER.ColliderDesc;

  /**
   * @internal Build the descriptor with material properties applied. Collision
   * events are enabled on every collider so the `PhysicsSystem` can deliver
   * `onCollisionEnter`/`onTriggerEnter` (and the `exit` pair) to components.
   */
  toDesc(): RAPIER.ColliderDesc {
    return this.shapeDesc()
      .setRestitution(this.restitution)
      .setFriction(this.friction)
      .setDensity(this.density)
      .setSensor(this.isSensor)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  }
}
