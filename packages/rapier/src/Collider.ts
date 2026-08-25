import RAPIER from '@dimforge/rapier3d-compat';
import { Component } from '@scenoco-three/core';
import { RigidBody } from './RigidBody.js';

/**
 * Shared base for the 3D collision shapes: `<BoxCollider>`, `<SphereCollider>`,
 * `<CapsuleCollider>`, `<CylinderCollider>` and `<PlaneCollider>` subclass this and implement
 * `shapeDesc()`.
 *
 * A collider attaches to the `<RigidBody>` **on its own node**, and does so itself — asked for
 * in `start`, which is when every component in the scene has woken, so the two may be written
 * in either order.
 *
 * Abstract, so it is machinery rather than a tag a document can write.
 */
export abstract class Collider extends Component {
  /** Bounciness, 0..1. */
  restitution = 0;
  /** Friction, 0..1. */
  friction = 0.5;
  /** Density in kg/m³. */
  density = 1;
  /** A trigger: reports overlaps and produces no collision response. */
  isSensor = false;

  /** The Rapier shape for this collider, without the shared material applied. */
  abstract shapeDesc(): RAPIER.ColliderDesc;

  /**
   * The full descriptor: this collider's shape, with its material and sensor flag.
   *
   * Collision events are enabled on every collider. Rapier reports nothing unless asked, and a
   * contact hook that silently never fires is far worse than the cost of the events.
   */
  toDesc(): RAPIER.ColliderDesc {
    return this.shapeDesc()
      .setRestitution(this.restitution)
      .setFriction(this.friction)
      .setDensity(this.density)
      .setSensor(this.isSensor)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  }

  /**
   * Re-apply this collider's shape and material to the body.
   *
   * A Rapier collider is fixed once created, so changing `radius`, `halfExtents`, `isSensor`
   * or the material at runtime does not reach the simulation on its own. Nothing needs this at
   * load time: authored values are applied before `awake`.
   */
  rebuild(): void {
    const body = this.body();
    if (!body) return;
    body.detachCollider(this);
    if (this.isActiveAndEnabled) body.attachCollider(this);
  }

  override start(): void {
    this.body()?.attachCollider(this);
  }

  override onEnable(): void {
    this.body()?.attachCollider(this);
  }

  override onDisable(): void {
    this.body()?.detachCollider(this);
  }

  override onDestroy(): void {
    this.body()?.detachCollider(this);
  }

  /** The body this collider gives shape to, or null while the node has none. */
  protected body(): RigidBody | null {
    return this.getComponent(RigidBody);
  }
}
