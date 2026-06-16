// `@scenoco-three/box2d` — 2D physics for SceNoCo on planck (a pure-JS Box2D
// port), built entirely on the public seams: a `Physics2DSystem extends System`,
// `@component` `RigidBody2D`/`Collider2D`, and a `<Physics2D>` `@attachment`.
// Core has no physics dependency; an app that doesn't import this package ships
// no 2D physics. The 3D counterpart is `@scenoco-three/rapier`.
//
// Importing this module registers the `RigidBody2D`, `Collider2D`, and
// `Physics2D` tags (decorator side effects) — hence the package is `sideEffects`.
//
// Unlike Rapier, planck is pure JS: there is NO async init — register the tags by
// importing the package and load the scene directly.
//
// The simulation runs in the XY plane: a body's position drives the node's x/y
// and its angle drives rotation.z. Contacts are delivered to components via
// duck-typed Unity-style hooks: onCollisionEnter2D / onCollisionExit2D /
// onTriggerEnter2D / onTriggerExit2D, each receiving the other node.

export { Physics2DSystem } from './Physics2DSystem.js';
export { RigidBody2D } from './RigidBody2D.js';
export { Collider2D } from './Collider2D.js';
export { Physics2D } from './Physics2D.js';

/**
 * The XML tags this package registers — read by the compiler/Vite plugin
 * (`registerPackages`) so a scene that uses them validates and imports the
 * package. The convention for any SceNoCo tag package.
 */
export const sceneTags = ['RigidBody2D', 'Collider2D', 'Physics2D'] as const;
