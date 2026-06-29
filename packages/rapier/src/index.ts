// `@scenoco-three/rapier` — Rapier physics for SceNoCo, built entirely on the
// public seams: a `PhysicsSystem extends System`, `@component` `RigidBody`/
// `Collider`, and a `<Physics>` `@setting`. Core has no physics dependency; an
// app that doesn't import this package ships no physics (and no Rapier WASM).
//
// Importing this module registers the `RigidBody`, the per-shape `*Collider`
// tags, and `Physics` (decorator side effects) — that's why the package is
// marked `sideEffects`.

import RAPIER from '@dimforge/rapier3d-compat';

export { PhysicsSystem } from './PhysicsSystem.js';
export { RigidBody } from './RigidBody.js';
// Each collision shape is its own tag (mirroring lights); `Collider` is the
// shared abstract base the system matches with `instanceof` (not a usable tag).
export { Collider } from './Collider.js';
export { BoxCollider } from './BoxCollider.js';
export { SphereCollider } from './SphereCollider.js';
export { CapsuleCollider } from './CapsuleCollider.js';
export { CylinderCollider } from './CylinderCollider.js';
export { PlaneCollider } from './PlaneCollider.js';
export { Physics } from './Physics.js';
export { Joint, JointKind } from './Joint.js';
export { JointSystem } from './JointSystem.js';

/**
 * The XML tags this package registers — read by the compiler/Vite plugin
 * (`registerPackages`) so a scene that uses them validates and imports the
 * package. The convention for any SceNoCo tag package.
 */
export const sceneTags = ['RigidBody', 'BoxCollider', 'SphereCollider', 'CapsuleCollider', 'CylinderCollider', 'PlaneCollider', 'Physics', 'Joint'] as const;

let initPromise: Promise<void> | undefined;

/**
 * Load the Rapier WASM once. Await it before `engine.loadScene()` of any scene
 * that uses `<Physics>` (a `World` cannot be built until the WASM is ready).
 * Idempotent — repeated calls share one initialization.
 */
export function initRapier(): Promise<void> {
  return (initPromise ??= RAPIER.init());
}
