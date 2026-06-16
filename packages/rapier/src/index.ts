// `@scenoco-three/rapier` — Rapier physics for SceNoCo, built entirely on the
// public seams: a `PhysicsSystem extends System`, `@component` `RigidBody`/
// `Collider`, and a `<Physics>` `@setting`. Core has no physics dependency; an
// app that doesn't import this package ships no physics (and no Rapier WASM).
//
// Importing this module registers the `RigidBody`, `Collider`, and `Physics`
// tags (decorator side effects) — that's why the package is marked `sideEffects`.

import RAPIER from '@dimforge/rapier3d-compat';

export { PhysicsSystem } from './PhysicsSystem.js';
export { RigidBody } from './RigidBody.js';
export { Collider } from './Collider.js';
export { Physics } from './Physics.js';

/**
 * The XML tags this package registers — read by the compiler/Vite plugin
 * (`registerPackages`) so a scene that uses them validates and imports the
 * package. The convention for any SceNoCo tag package.
 */
export const sceneTags = ['RigidBody', 'Collider', 'Physics'] as const;

let initPromise: Promise<void> | undefined;

/**
 * Load the Rapier WASM once. Await it before `engine.loadScene()` of any scene
 * that uses `<Physics>` (a `World` cannot be built until the WASM is ready).
 * Idempotent — repeated calls share one initialization.
 */
export function initRapier(): Promise<void> {
  return (initPromise ??= RAPIER.init());
}
