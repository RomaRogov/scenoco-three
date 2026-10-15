/**
 * Physics on Rapier, in Unity's shape: `Rigidbody`, `BoxCollider`/`SphereCollider`/`CapsuleCollider`,
 * and the contact messages on any behaviour.
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

// The hooks exist — typed — only where this package is imported.
declare module '@scenoco-three/core' {
  interface BehaviourHooks {
    /** A solid contact with another collider began. */
    onCollisionEnter?(collision: Collision): void;
    onCollisionExit?(collision: Collision): void;
    /** Another collider entered this trigger, or this collider entered its trigger. */
    onTriggerEnter?(other: Collider): void;
    onTriggerExit?(other: Collider): void;
  }
}
declareMessages(['onCollisionEnter', 'onCollisionExit', 'onTriggerEnter', 'onTriggerExit']);

export { Physics, type Collision } from './Physics.js';
export { Rigidbody, ForceMode } from './Rigidbody.js';
export { Collider, BoxCollider, SphereCollider, CapsuleCollider } from './colliders.js';

let loading: Promise<void> | undefined;

/** Load Rapier's WebAssembly. Await it once before the first scene with physics renders. */
export function initRapier(): Promise<void> {
  return (loading ??= RAPIER.init());
}
