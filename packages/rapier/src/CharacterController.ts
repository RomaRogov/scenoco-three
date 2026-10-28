import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, type Object3D } from 'three';
import { Time, sendMessage } from '@scenoco-three/core';
import { Collider, capsuleSize } from './colliders.js';
import type { Physics } from './Physics.js';
import type { Rigidbody } from './Rigidbody.js';

/** Where a `CharacterController`'s last `move` touched something — Unity's `CollisionFlags`, combined with `|`. */
export const CollisionFlags = {
  None: 0,
  Sides: 1,
  Above: 2,
  Below: 4,
} as const;
export type CollisionFlags = number;

/** What `onControllerColliderHit` receives — Unity's `ControllerColliderHit`. */
export interface ControllerColliderHit {
  controller: CharacterController;
  /** What it hit. */
  collider: Collider;
  rigidbody: Rigidbody | null;
  node: Object3D;
  /** Where, in world space. */
  point: Vector3;
  /** Out of what it hit, towards the controller. */
  normal: Vector3;
  /** The way it was moving, unit long. */
  moveDirection: Vector3;
  /** How far it went in that `move` before the hit. */
  moveLength: number;
}

/**
 * Unity's `CharacterController`: a capsule that walks — moved only by `move` / `simpleMove`, stopped
 * and slid along by what it meets, up slopes to `slopeLimit` and steps to `stepOffset`. No forces
 * move it, and it pushes nothing: push a body in `onControllerColliderHit`, as in Unity. It is a
 * collider too: triggers, queries and contacts see it. Not beside a `Rigidbody`.
 *
 * ```ts
 * const controller = this.getComponent(CharacterController)!;
 * controller.simpleMove(new Vector3(Input.getAxis('Horizontal'), 0, -Input.getAxis('Vertical')).multiplyScalar(5));
 * ```
 */
export class CharacterController extends Collider {
  /** The steepest slope it walks up, in degrees. */
  slopeLimit = 45;
  /** The tallest step it climbs, in metres. */
  stepOffset = 0.3;
  /** The gap it keeps from what it touches. */
  skinWidth = 0.08;
  /** A `move` shorter than this does nothing. */
  minMoveDistance = 0.001;
  radius = 0.5;
  /** The whole capsule, caps included. */
  height = 2;

  private _flags: CollisionFlags = CollisionFlags.None;
  private _grounded = false;
  private readonly _velocity = new Vector3();
  /** `simpleMove`'s fall: gravity gathered while it is in the air. */
  private _fall = 0;
  private _body: RAPIER.RigidBody | null = null;
  private _controller: RAPIER.KinematicCharacterController | null = null;
  /** Where `move` last put it: a node moved anywhere else since was teleported, and the body follows. */
  private readonly _placed = new Vector3(Number.NaN, 0, 0);

  /** Whether the last `move` touched the ground — Unity's `isGrounded`. */
  get isGrounded(): boolean {
    return this._grounded;
  }

  /** What the last `move` touched — Unity's `collisionFlags`. */
  get collisionFlags(): CollisionFlags {
    return this._flags;
  }

  /** How fast it really moved in the last `move`, per second. */
  get velocity(): Vector3 {
    return this._velocity;
  }

  /**
   * Move by `motion` — metres, world space, this frame's share: multiply a speed by `Time.deltaTime`.
   * No gravity: add it yourself, or use `simpleMove`. Says what it touched.
   */
  move(motion: Vector3): CollisionFlags {
    const collider = this._collider;
    const body = this._body;
    const physics = this._physics;
    if (!collider || !body || !physics || motion.length() < this.minMoveDistance) return this._flags;
    const node = this.node;
    const at = node.getWorldPosition(SCRATCH);
    if (at.distanceToSquared(this._placed) > 1e-10) this.place(at);

    const controller = this.controller(physics.world);
    controller.computeColliderMovement(collider, motion, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (other) => other.handle !== collider.handle);
    const moved = controller.computedMovement();
    const to = at.clone().add(SCRATCH_M.set(moved.x, moved.y, moved.z));
    this.place(to);
    const parent = node.parent;
    node.position.copy(parent ? parent.worldToLocal(to.clone()) : to);
    const dt = Time.deltaTime;
    if (dt > 0) this._velocity.set(moved.x, moved.y, moved.z).divideScalar(dt);

    let flags: CollisionFlags = CollisionFlags.None;
    const direction = motion.clone().normalize();
    const hits: ControllerColliderHit[] = [];
    for (let i = 0; i < controller.numComputedCollisions(); i++) {
      const hit = controller.computedCollision(i);
      const other = hit?.collider ? physics.colliderOf(hit.collider) : null;
      if (!hit || !other) continue;
      const n = hit.normal1;
      flags |= n.y > 0.5 ? CollisionFlags.Below : n.y < -0.5 ? CollisionFlags.Above : CollisionFlags.Sides;
      const applied = hit.translationDeltaApplied;
      hits.push({
        controller: this,
        collider: other,
        rigidbody: other.attachedRigidbody,
        node: other.node,
        point: new Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
        normal: new Vector3(n.x, n.y, n.z),
        moveDirection: direction.clone(),
        moveLength: Math.hypot(applied.x, applied.y, applied.z),
      });
    }
    this._grounded = controller.computedGrounded() || (flags & CollisionFlags.Below) !== 0;
    if (this._grounded) flags |= CollisionFlags.Below;
    this._flags = flags;
    for (const hit of hits) sendMessage(node, 'onControllerColliderHit', hit);
    return flags;
  }

  /**
   * Walk at `speed` metres per second — Unity's `SimpleMove`: its height is ignored and gravity is
   * added, so call it once a frame. Says whether it is on the ground.
   */
  simpleMove(speed: Vector3): boolean {
    const dt = Time.deltaTime;
    this._fall = this._grounded ? 0 : this._fall + GRAVITY * dt;
    this.move(SCRATCH_S.set(speed.x * dt, (this._fall - 0.5) * dt, speed.z * dt));
    return this._grounded;
  }

  shape(scale: Vector3): RAPIER.ColliderDesc {
    const { half, radius } = capsuleSize(this.radius, this.height, scale);
    return RAPIER.ColliderDesc.capsule(half, radius);
  }

  override _resize(created: RAPIER.Collider, scale: Vector3): boolean {
    const { half, radius } = capsuleSize(this.radius, this.height, scale);
    created.setRadius(radius);
    created.setHalfHeight(half);
    return true;
  }

  /** @internal its own kinematic body: moved only by `move`, as Unity's controller is. */
  override _ownBody(physics: Physics): RAPIER.RigidBody {
    const p = this.node.getWorldPosition(SCRATCH);
    this._body ??= physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
    this._placed.copy(p);
    return this._body;
  }

  override onDisable(): void {
    super.onDisable();
    this.release();
  }

  override onDestroy(): void {
    super.onDestroy();
    this.release();
  }

  private place(at: Vector3): void {
    this._body?.setTranslation(at, true);
    // Its collider is where the next move starts from: brought along now, not at the next step.
    this._physics?.world.propagateModifiedBodyPositionsToColliders();
    this._placed.copy(at);
  }

  private controller(world: RAPIER.World): RAPIER.KinematicCharacterController {
    const controller = (this._controller ??= world.createCharacterController(this.skinWidth));
    controller.setOffset(this.skinWidth);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle((this.slopeLimit * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((this.slopeLimit * Math.PI) / 180);
    if (this.stepOffset > 0) controller.enableAutostep(this.stepOffset, this.radius / 2, false);
    else controller.disableAutostep();
    return controller;
  }

  private release(): void {
    const world = this._physics?.world;
    if (world && this._controller) world.removeCharacterController(this._controller);
    if (world && this._body && world.getRigidBody(this._body.handle)) world.removeRigidBody(this._body);
    this._controller = null;
    this._body = null;
  }
}

/** Unity's default gravity, which `simpleMove` falls by. */
const GRAVITY = -9.81;
const SCRATCH = new Vector3();
const SCRATCH_M = new Vector3();
const SCRATCH_S = new Vector3();
