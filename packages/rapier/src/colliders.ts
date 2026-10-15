import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Behaviour, service } from '@scenoco-three/core';
import { Physics } from './Physics.js';
import { Rigidbody } from './Rigidbody.js';

/**
 * Unity's `Collider`: a shape. With a `Rigidbody` on the same node it shapes that body; without
 * one it is static — a floor, a wall, a coin — and moving its node still moves it, as in Unity.
 * Sizes are scaled by the node's world scale, as Unity scales them, so `<BoxCollider />` on a
 * mesh scaled to 4 is 4 wide.
 */
export abstract class Collider extends Behaviour {
  /** Reports `onTriggerEnter`/`Exit` instead of colliding. */
  isTrigger = false;
  /** Offset from the node, before scale. */
  center = new Vector3();
  friction = 0.5;
  /** 0 stops dead, 1 bounces back as high. */
  bounciness = 0;
  /** Kilograms per cubic metre: with the size, the body's mass. */
  density = 1;

  /** @internal */ _collider: RAPIER.Collider | null = null;
  /** @internal */ _physics: Physics | null = null;

  /**
   * The Rapier collider, once this has started — for Rapier's own API: the character controller,
   * query filters. `physics.colliderOf()` turns one back into this.
   */
  get rapierCollider(): RAPIER.Collider | null {
    return this._collider;
  }

  /** The body this collider shapes, or null for a static collider. */
  get attachedRigidbody(): Rigidbody | null {
    return this._node ? this.getComponent(Rigidbody) : null;
  }

  /** @internal the shape at this world scale. */
  abstract shape(scale: Vector3): RAPIER.ColliderDesc;

  // `start`, not `awake`: by then every behaviour on the node is awake, so a Rigidbody written
  // after its collider already has its body.
  override start(): void {
    this.add();
  }

  override onEnable(): void {
    if (this._started) this.add();
  }

  override onDisable(): void {
    this.remove();
  }

  override onDestroy(): void {
    this.remove();
  }

  private add(): void {
    const rigidbody = this.attachedRigidbody;
    if (rigidbody) return rigidbody.attach(this);
    if (this._collider) return;
    this._physics = service(this.node, Physics);
    this._collider = this._physics.createCollider(this, null);
  }

  private remove(): void {
    const rigidbody = this.attachedRigidbody;
    if (rigidbody) rigidbody.detach(this);
    else if (this._collider) this._physics?.destroyCollider(this._collider);
    this._collider = null;
  }
}

export class BoxCollider extends Collider {
  /** Full size, as in Unity — not half. */
  size = new Vector3(1, 1, 1);

  shape(scale: Vector3): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cuboid((this.size.x * scale.x) / 2, (this.size.y * scale.y) / 2, (this.size.z * scale.z) / 2);
  }
}

export class SphereCollider extends Collider {
  radius = 0.5;

  shape(scale: Vector3): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.ball(this.radius * Math.max(scale.x, scale.y, scale.z));
  }
}

/** Upright, as Unity's default. `height` is the whole capsule, caps included. */
export class CapsuleCollider extends Collider {
  radius = 0.5;
  height = 2;

  shape(scale: Vector3): RAPIER.ColliderDesc {
    const radius = this.radius * Math.max(scale.x, scale.z);
    const half = Math.max((this.height * scale.y) / 2 - radius, 0);
    return RAPIER.ColliderDesc.capsule(half, radius);
  }
}
