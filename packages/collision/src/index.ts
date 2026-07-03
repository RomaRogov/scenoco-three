// `@scenoco-three/collision` — lightweight, **detection-only** collision for
// SceNoCo, with an API **identical to `@scenoco-three/rapier`** so switching
// engines is just swapping the import: the same `<BoxCollider>`/`<RigidBody>`
// scene and the same `onCollisionEnter`/`onTriggerEnter` component code run on
// either. This one detects overlaps and dispatches the contact hooks; it has no
// dynamics (bodies/gravity are inert). Use rapier when you need real physics.
//
// The tags share rapier's names on purpose — importing both packages throws a
// duplicate-registration error, so a project commits to one engine (Cocos-style
// backend selection). Importing this module registers the tags (decorator side
// effect), which is why the package is marked `sideEffects`.
export { Collider, type Bounds, type ContactHandlers } from './Collider.js';
export { BoxCollider } from './BoxCollider.js';
export { SphereCollider } from './SphereCollider.js';
export { CapsuleCollider } from './CapsuleCollider.js';
export { CylinderCollider } from './CylinderCollider.js';
export { PlaneCollider } from './PlaneCollider.js';
export { RigidBody, RigidBodyKind } from './RigidBody.js';
export { Physics } from './Physics.js';
export { CollisionSystem } from './CollisionSystem.js';

/**
 * The tags this package registers — read by the compiler/Vite plugin
 * (`registerPackages`) so a scene using them validates and imports the package.
 * Mirrors rapier's surface (colliders + `RigidBody` + `Physics`).
 * (`CollisionSystem` keys off the `Collider` type, not a tag.)
 */
export const sceneTags = [
  'BoxCollider',
  'SphereCollider',
  'CapsuleCollider',
  'CylinderCollider',
  'PlaneCollider',
  'RigidBody',
  'Physics',
] as const;
