/**
 * `@scenoco-three/box2d` — 2D physics for SceNoCo, on planck (a pure-JS Box2D port).
 *
 * Core has no physics dependency: an app that does not import this package ships none. The 3D
 * counterpart is `@scenoco-three/rapier`.
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <Physics2D gravity="x: 0; y: -9.81" />
 *   </Systems>
 *
 *   <Mesh id="ball" geometry="…" material="…" position="y: 5">
 *     <Components>
 *       <RigidBody2D kind="dynamic" bullet="true" />
 *       <CircleCollider2D radius="0.3" restitution="1" />
 *     </Components>
 *   </Mesh>
 * </Scene>
 * ```
 *
 * The simulation runs in the **XY plane**: a body's position drives the node's x and y, and its
 * angle drives `rotation.z`.
 *
 * Contacts arrive as typed hooks on any component — `onCollisionEnter2D`, `onCollisionExit2D`,
 * `onTriggerEnter2D`, `onTriggerExit2D` — each taking the other node. They are declared the way
 * core declares its own lifecycle hooks, so `override` checks them and a misspelling is a build
 * error rather than a handler that never fires.
 *
 * Unlike Rapier, planck is pure JS: there is no async init, and nothing to await before a scene
 * loads.
 */

// Side effect: merges the contact hooks onto `Component`. Imported here so anything that
// touches this package can implement them.
import './contacts.js';

export { Physics2D } from './Physics2D.js';
export { RigidBody2D, type RigidBody2DKind } from './RigidBody2D.js';
export { type Contact2DHandlers } from './contacts.js';

// Each shape is its own tag, mirroring how each light is. `Collider2D` is the abstract base
// they share; it is machinery, not something a document writes.
export { Collider2D } from './Collider2D.js';
export { BoxCollider2D } from './BoxCollider2D.js';
export { CircleCollider2D } from './CircleCollider2D.js';
export { CapsuleCollider2D, type CapsuleDirection2D } from './CapsuleCollider2D.js';
export { EdgeCollider2D } from './EdgeCollider2D.js';
export { PolygonCollider2D } from './PolygonCollider2D.js';
export { ChainCollider2D } from './ChainCollider2D.js';
