import { Vector2, type Object3D } from 'three';
import type { Collider2D } from './Collider2D.js';
import type { Rigidbody2D } from './Rigidbody2D.js';

/** One point where two colliders touch — Unity's `ContactPoint2D`. */
export interface ContactPoint2D {
  /** Where, in world space. */
  point: Vector2;
  /** Out of the other collider, towards this one. */
  normal: Vector2;
  /** How far apart the two surfaces are there: negative while they overlap. */
  separation: number;
  /** The impulse that pushed them apart there this step, in newton-seconds. */
  normalImpulse: number;
  collider: Collider2D;
  otherCollider: Collider2D;
}

/**
 * What `onCollisionEnter2D` / `Stay2D` / `Exit2D` receive — Unity's `Collision2D`: the other side,
 * and where and how hard they touch.
 */
export class Collision2D {
  /** The other collider's node — Unity's `collision.gameObject`. */
  readonly node: Object3D;
  /** The other collider. */
  readonly collider: Collider2D;
  /** This side's collider. */
  readonly otherCollider: Collider2D;
  /** The other collider's body, or null for a static collider. */
  readonly rigidbody: Rigidbody2D | null;
  /** This side's body, or null. */
  readonly otherRigidbody: Rigidbody2D | null;
  /** How fast the other side was moving against this one when they met — its velocity minus this one's. */
  readonly relativeVelocity: Vector2;
  private readonly found: (self: Collider2D, other: Collider2D) => ContactPoint2D[];
  private _contacts: ContactPoint2D[] | null = null;

  /** @internal */
  constructor(
    self: { collider: Collider2D; rigidbody: Rigidbody2D | null },
    other: { collider: Collider2D; rigidbody: Rigidbody2D | null; node: Object3D },
    relativeVelocity: Vector2,
    found: (self: Collider2D, other: Collider2D) => ContactPoint2D[],
  ) {
    this.node = other.node;
    this.collider = other.collider;
    this.otherCollider = self.collider;
    this.rigidbody = other.rigidbody;
    this.otherRigidbody = self.rigidbody;
    this.relativeVelocity = relativeVelocity;
    this.found = found;
  }

  /** Where the two touch now — Unity's `collision.contacts`. Empty on exit. */
  get contacts(): ContactPoint2D[] {
    return (this._contacts ??= this.found(this.otherCollider, this.collider));
  }

  /** Unity's `collision.contactCount`. */
  get contactCount(): number {
    return this.contacts.length;
  }

  /** Unity's `collision.GetContact(i)`. */
  getContact(index: number): ContactPoint2D {
    const contact = this.contacts[index];
    if (!contact) throw new RangeError(`Collision2D.getContact(${index}): it has ${this.contactCount} contact${this.contactCount === 1 ? '' : 's'}.`);
    return contact;
  }
}

/** A query's hit — Unity's `RaycastHit2D`. */
export interface RaycastHit2D {
  collider: Collider2D;
  /** The collider's body, or null for a static collider. */
  rigidbody: Rigidbody2D | null;
  /** The collider's node. */
  node: Object3D;
  /** Where it was hit, in world space. */
  point: Vector2;
  /** The surface's normal there, out of the collider. */
  normal: Vector2;
  /** From the query's origin to `point`. */
  distance: number;
  /** How far along the query's length, 0..1. */
  fraction: number;
}
