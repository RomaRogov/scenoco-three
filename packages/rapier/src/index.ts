/**
 * Physics on Rapier, in Unity's shape: `Rigidbody`, `BoxCollider`/`SphereCollider`/`CapsuleCollider`,
 * `MeshCollider` (`convex` for a moving body), `TerrainCollider` (a `TerrainData`'s ground),
 * `PhysicsMaterial` (a surface colliders share, with combine modes), `CharacterController`, joints,
 * `Physics.raycast` and the other queries, and the contact messages on any behaviour —
 * `collision.impulse` says how hard a hit was. Rapier itself stays in view: `Physics.world`.
 *
 * ```tsx
 * await initRapier(); // WebAssembly: once, before the scene renders
 *
 * <Mesh>
 *   <SphereGeometry />
 *   <Rigidbody />
 *   <SphereCollider bounciness={0.6} />
 *   <Ball />
 * </Mesh>
 * ```
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { declareMessages } from '@scenoco-three/core';
import type { Collider } from './colliders.js';
import type { Collision } from './Physics.js';
import type { ControllerColliderHit } from './CharacterController.js';

// The hooks exist — typed — only where this package is imported.
declare module '@scenoco-three/core' {
  interface BehaviourHooks {
    /** A solid contact with another collider began. */
    onCollisionEnter?(collision: Collision): void;
    /** Every physics step while the contact lasts, after the one it began in. */
    onCollisionStay?(collision: Collision): void;
    onCollisionExit?(collision: Collision): void;
    /** Another collider entered this trigger, or this collider entered its trigger. */
    onTriggerEnter?(other: Collider): void;
    onTriggerStay?(other: Collider): void;
    onTriggerExit?(other: Collider): void;
    /** This node's `CharacterController` hit a collider while it moved. */
    onControllerColliderHit?(hit: ControllerColliderHit): void;
  }
}
declareMessages(['onCollisionEnter', 'onCollisionStay', 'onCollisionExit', 'onTriggerEnter', 'onTriggerStay', 'onTriggerExit', 'onControllerColliderHit']);

export { Physics, Collision, QueryTriggerInteraction, type ContactPoint, type RaycastHit } from './Physics.js';
export { Rigidbody, ForceMode, RigidbodyConstraints } from './Rigidbody.js';
export { PhysicsMaterial, PhysicsMaterialCombine } from './PhysicsMaterial.js';
export { Joint, FixedJoint, HingeJoint, SpringJoint, type JointLimits, type JointMotor } from './joints.js';
export { CharacterController, CollisionFlags, type ControllerColliderHit } from './CharacterController.js';
export { Collider, BoxCollider, SphereCollider, CapsuleCollider, MeshCollider, TerrainCollider, type TerrainHeights } from './colliders.js';

let loading: Promise<void> | undefined;

/** Load Rapier's WebAssembly. Await it once before the first scene with physics renders. */
export function initRapier(): Promise<void> {
  return (loading ??= RAPIER.init());
}
