import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Component } from '@scenoco-three/core';
import { Collider } from './Collider.js';
import { Physics } from './Physics.js';

// These three modules import one another. That is safe here and worth stating rather than
// working around: an import cycle only bites when a module *evaluates* something from the
// other while it is still initialising, and none of these classes touches another in its
// `extends` clause or a field initializer — the references are all inside methods, which run
// long after every module has finished loading.

/** How a 3D body moves. */
export type RigidBodyKind = 'dynamic' | 'fixed' | 'kinematic';

/**
 * Makes this node a 3D physics body. Pair it with one or more colliders on the same node to
 * give it shape.
 *
 * ```xml
 * <Mesh geometry="…" material="…">
 *   <Components>
 *     <RigidBody kind="dynamic" ccd="true" />
 *     <SphereCollider radius="0.5" restitution="0.6" />
 *   </Components>
 * </Mesh>
 * ```
 *
 * - `dynamic` — simulated; physics drives the node's position and rotation
 * - `fixed` — never moves (Rapier's name for what Unity calls static)
 * - `kinematic` — moved by your code; set `object3D.position` and the body follows
 *
 * The body joins the world in `awake` and leaves it in `onDestroy`.
 *
 * These three modules import one another, which is safe and worth stating rather than working
 * around: none of these classes touches another in its `extends` clause or a field
 * initializer, so every reference runs long after all of them have loaded.
 */
export class RigidBody extends Component {
  /** How the body moves. */
  kind: RigidBodyKind = 'dynamic';
  /** Damps linear velocity over time. */
  linearDamping = 0;
  /** Damps angular velocity over time. */
  angularDamping = 0;
  /** Multiplier on world gravity for this body alone. */
  gravityScale = 1;
  /** Continuous collision detection, for something fast enough to tunnel through a wall. */
  ccd = false;

  /** The live Rapier body. Exists from `awake` until `onDestroy`. */
  body: RAPIER.RigidBody | null = null;

  private physics: Physics | null = null;
  /** Colliders currently contributing a shape, so a disable can remove exactly one. */
  private readonly colliders = new Map<Collider, RAPIER.Collider>();

  // --- lifecycle -------------------------------------------------------------------------

  override awake(): void {
    // `requireSystem` rather than `getSystem`: a scene that never declared `<Physics>` still
    // gets a world with default gravity. Declaring one only configures it.
    this.physics = this.requireSystem(Physics);
    this.body = this.physics.createBody(this);
    // A collider that already started — the body was added afterwards — has nothing left to
    // attach it. Sweeping the node closes that direction, so the two may arrive in either order.
    for (const collider of this.object3D.getComponents(Collider)) {
      if (collider.isActiveAndEnabled) this.attachCollider(collider);
    }
  }

  override onEnable(): void {
    // Unity's `Rigidbody.isKinematic`-adjacent semantics: a disabled body leaves the
    // simulation — its contacts end, its velocities are kept — and rejoins where its node is
    // now, since a script may have moved it in the meantime.
    if (!this.body) return;
    this.body.setEnabled(true);
    this.syncFromNode();
    this.physics?.resetInterpolation(this);
  }

  override onDisable(): void {
    this.body?.setEnabled(false);
  }

  override onDestroy(): void {
    this.physics?.destroyBody(this);
    this.colliders.clear();
    this.body = null;
    this.physics = null;
  }

  // --- colliders -------------------------------------------------------------------------

  /** Give the body a Rapier collider for this shape. Idempotent. */
  attachCollider(collider: Collider): void {
    if (!this.body || !this.physics || this.colliders.has(collider)) return;
    const created = this.physics.createCollider(collider, this);
    this.colliders.set(collider, created);
  }

  /** Take this shape's collider off the body. Idempotent. */
  detachCollider(collider: Collider): void {
    const created = this.colliders.get(collider);
    if (!created || !this.physics) return;
    this.physics.destroyCollider(created);
    this.colliders.delete(collider);
  }

  // --- driving it ------------------------------------------------------------------------

  /** Copy the node's world pose onto the body. */
  syncFromNode(): void {
    const position = this.object3D.getWorldPosition(SCRATCH_POSITION);
    const rotation = this.object3D.getWorldQuaternion(SCRATCH_ROTATION);
    this.body?.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body?.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true);
  }

  /** Apply an instantaneous impulse at the body's centre of mass, waking it. */
  applyImpulse(x: number, y: number, z: number): void {
    this.body?.applyImpulse({ x, y, z }, true);
  }

  /** Set the linear velocity, waking the body. */
  setVelocity(x: number, y: number, z: number): void {
    this.body?.setLinvel({ x, y, z }, true);
  }

  /** Current linear velocity, or all zeroes before the body exists. */
  getVelocity(): Vector3 {
    const velocity = this.body?.linvel();
    return velocity ? new Vector3(velocity.x, velocity.y, velocity.z) : new Vector3();
  }

  /** Teleport the body, waking it — a respawn or a reset. */
  setPosition(x: number, y: number, z: number): void {
    if (!this.body) return;
    this.body.setTranslation({ x, y, z }, true);
    this.physics?.resetInterpolation(this);
  }

  /** @internal the Rapier descriptor for this body's kind. */
  describe(): RAPIER.RigidBodyDesc {
    switch (this.kind) {
      case 'fixed':
        return RAPIER.RigidBodyDesc.fixed();
      case 'kinematic':
        return RAPIER.RigidBodyDesc.kinematicPositionBased();
      default:
        return RAPIER.RigidBodyDesc.dynamic();
    }
  }
}

// Reused across every body: `syncFromNode` runs per body per step, and two fresh vectors each
// time is allocation the simulation does not need.
const SCRATCH_POSITION = new Vector3();
const SCRATCH_ROTATION = new Quaternion();
