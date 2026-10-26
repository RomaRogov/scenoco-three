import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Behaviour, service } from '@scenoco-three/core';
import { Collider } from './colliders.js';
import { Physics } from './Physics.js';

/** How `addForce` applies a vector — Unity's `ForceMode`. */
export const ForceMode = {
  /** Newtons, over one fixed step: mass matters. The default. */
  Force: 0,
  /** Like `Force`, ignoring mass. */
  Acceleration: 1,
  /** Newton-seconds, at once: mass matters. A jump, a hit. */
  Impulse: 2,
  /** A velocity change, at once, ignoring mass. */
  VelocityChange: 3,
} as const;
export type ForceMode = (typeof ForceMode)[keyof typeof ForceMode];

/**
 * The axes a body may not move along or turn about — Unity's `RigidbodyConstraints`, with its values,
 * combined with `|`: `constraints={RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationY}`.
 */
export const RigidbodyConstraints = {
  None: 0,
  FreezePositionX: 2,
  FreezePositionY: 4,
  FreezePositionZ: 8,
  FreezeRotationX: 16,
  FreezeRotationY: 32,
  FreezeRotationZ: 64,
  FreezePosition: 14,
  FreezeRotation: 112,
  FreezeAll: 126,
} as const;
/** One of `RigidbodyConstraints`, or several combined with `|`. */
export type RigidbodyConstraints = number;

/**
 * Unity's `Rigidbody`: makes its node a physics body. Its shape comes from the colliders on the
 * same node, in either order.
 *
 * A dynamic body moves its node — set velocity or add force, not `node.position`. A kinematic
 * one follows its node: move the node, and the body pushes whatever it meets. `isKinematic` may
 * change at any time, as in Unity — set it to pick a body up, clear it to let go.
 */
export class Rigidbody extends Behaviour {
  isKinematic = false;
  /** The fastest it may spin, radians per second — Unity's cap, 7 by default, so a body cannot spin up without end. */
  maxAngularVelocity = 7;

  /** @internal */ _body: RAPIER.RigidBody | null = null;
  /** @internal */ _physics: Physics | null = null;
  /** @internal */ readonly _attached = new Map<Collider, RAPIER.Collider>();

  private _constraints: RigidbodyConstraints = RigidbodyConstraints.None;
  private _useGravity = true;
  private _linearDamping = 0;
  private _angularDamping = 0.05;

  // Unity applies these at once, so they are applied at once here too.
  get useGravity(): boolean {
    return this._useGravity;
  }
  set useGravity(on: boolean) {
    this._useGravity = on;
    this._body?.setGravityScale(on ? 1 : 0, true);
  }

  get linearDamping(): number {
    return this._linearDamping;
  }
  set linearDamping(value: number) {
    this._linearDamping = value;
    this._body?.setLinearDamping(value);
  }

  get angularDamping(): number {
    return this._angularDamping;
  }
  set angularDamping(value: number) {
    this._angularDamping = value;
    this._body?.setAngularDamping(value);
  }

  /** The axes it may not move along or turn about. A change applies at once, as in Unity. */
  get constraints(): RigidbodyConstraints {
    return this._constraints;
  }
  set constraints(value: RigidbodyConstraints) {
    this._constraints = value;
    this.applyConstraints();
  }

  /** Keep it from turning at all — what a character usually wants. Unity's shorthand for `FreezeRotation`. */
  get freezeRotation(): boolean {
    return (this._constraints & RigidbodyConstraints.FreezeRotation) === RigidbodyConstraints.FreezeRotation;
  }
  set freezeRotation(on: boolean) {
    this.constraints = on ? this._constraints | RigidbodyConstraints.FreezeRotation : this._constraints & ~RigidbodyConstraints.FreezeRotation;
  }

  /**
   * The Rapier body, from `awake` to `onDestroy` — use Rapier's own API on it for anything not
   * here: joints, `setNextKinematicTranslation`, locking axes. Its `userData` is this Rigidbody.
   */
  get rapierBody(): RAPIER.RigidBody | null {
    return this._body;
  }

  /** Total mass, from the colliders' density and size. */
  get mass(): number {
    return this._body?.mass() ?? 0;
  }

  /**
   * Linear velocity. Assign a whole vector: `rb.velocity = new Vector3(0, 5, 0)`. The value read is
   * a frozen copy, so `rb.velocity.y = 5` throws instead of silently changing nothing.
   */
  get velocity(): Vector3 {
    const v = this._body?.linvel();
    return Object.freeze(new Vector3(v?.x ?? 0, v?.y ?? 0, v?.z ?? 0));
  }

  set velocity(value: Vector3) {
    // Rapier's locks stop forces and contacts, not a velocity handed to it: drop what is frozen, as Unity does.
    const c = this._constraints;
    const F = RigidbodyConstraints;
    this._body?.setLinvel({ x: c & F.FreezePositionX ? 0 : value.x, y: c & F.FreezePositionY ? 0 : value.y, z: c & F.FreezePositionZ ? 0 : value.z }, true);
  }

  /** Angular velocity, radians per second. Assign a whole vector, as with `velocity`. */
  get angularVelocity(): Vector3 {
    const w = this._body?.angvel();
    return Object.freeze(new Vector3(w?.x ?? 0, w?.y ?? 0, w?.z ?? 0));
  }

  set angularVelocity(value: Vector3) {
    const c = this._constraints;
    const F = RigidbodyConstraints;
    this._body?.setAngvel({ x: c & F.FreezeRotationX ? 0 : value.x, y: c & F.FreezeRotationY ? 0 : value.y, z: c & F.FreezeRotationZ ? 0 : value.z }, true);
  }

  addForce(force: Vector3, mode: ForceMode = ForceMode.Force): void {
    if (!this._body) return;
    const dt = this._physics?.runtime.fixedDelta ?? 0.02;
    const scale = mode === ForceMode.Force ? dt : mode === ForceMode.Acceleration ? dt * this.mass : mode === ForceMode.Impulse ? 1 : this.mass;
    this._body.applyImpulse(SCRATCH_V.copy(force).multiplyScalar(scale), true);
  }

  addTorque(torque: Vector3, mode: ForceMode = ForceMode.Force): void {
    if (!this._body) return;
    const dt = this._physics?.runtime.fixedDelta ?? 0.02;
    const scale = mode === ForceMode.Force || mode === ForceMode.Acceleration ? dt : 1;
    this._body.applyTorqueImpulse(SCRATCH_V.copy(torque).multiplyScalar(scale), true);
  }

  /** Teleport — a respawn. For a kinematic body, moving its node is the usual way. */
  movePosition(position: Vector3): void {
    if (!this._body) return;
    if (this.isKinematic) this._body.setNextKinematicTranslation(position);
    else {
      this._body.setTranslation(position, true);
      this._physics?.resetPose(this);
    }
  }

  moveRotation(rotation: Quaternion): void {
    if (!this._body) return;
    if (this.isKinematic) this._body.setNextKinematicRotation(rotation);
    else this._body.setRotation(rotation, true);
  }

  // --- lifecycle -----------------------------------------------------------------------------

  override awake(): void {
    this._physics = service(this.node, Physics);
    this._body = this._physics.createBody(this);
    this.applyConstraints();
    // A collider that started before this body existed has nothing else to attach it.
    for (const collider of this.getComponents(Collider)) if (collider._started && collider.enabled) this.attach(collider);
  }

  override onEnable(): void {
    if (!this._body) return;
    this._body.setEnabled(true);
    this.movePosition(this.node.getWorldPosition(SCRATCH_V));
  }

  override onDisable(): void {
    this._body?.setEnabled(false);
  }

  override onDestroy(): void {
    this._physics?.destroyBody(this);
    for (const collider of this._attached.keys()) collider._collider = null;
    this._attached.clear();
    this._body = null;
  }

  private applyConstraints(): void {
    const c = this._constraints;
    const free = (flag: number) => (c & flag) === 0;
    const F = RigidbodyConstraints;
    this._body?.setEnabledTranslations(free(F.FreezePositionX), free(F.FreezePositionY), free(F.FreezePositionZ), true);
    this._body?.setEnabledRotations(free(F.FreezeRotationX), free(F.FreezeRotationY), free(F.FreezeRotationZ), true);
    // A frozen axis stops now, as in Unity: Rapier's lock only keeps it from gaining speed.
    this.velocity = this.velocity;
    this.angularVelocity = this.angularVelocity;
  }

  /** @internal */
  attach(collider: Collider): void {
    if (!this._body || !this._physics || this._attached.has(collider)) return;
    const created = this._physics.createCollider(collider, this._body);
    collider._collider = created;
    this._attached.set(collider, created);
  }

  /** @internal */
  detach(collider: Collider): void {
    const created = this._attached.get(collider);
    if (!created) return;
    this._physics?.destroyCollider(created);
    this._attached.delete(collider);
  }
}

const SCRATCH_V = new Vector3();
