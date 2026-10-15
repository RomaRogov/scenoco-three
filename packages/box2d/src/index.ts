/**
 * `@scenoco-three/box2d` — 2D physics on planck (a pure-JS Box2D port), in Unity's shape.
 *
 * ```tsx
 * <Mesh position={[0, 5, 0]}>
 *   <SphereGeometry args={[0.3]} />
 *   <Rigidbody2D bullet />
 *   <CircleCollider2D radius={0.3} restitution={1} />
 * </Mesh>
 * ```
 *
 * The simulation runs in the **XY plane**: a body's position drives the node's x and y, and its
 * angle drives `rotation.z`. `Physics2D.gravity` is the world's gravity.
 *
 * Contacts arrive as Unity's messages on any behaviour of either node — `onCollisionEnter2D`,
 * `onCollisionExit2D`, `onTriggerEnter2D`, `onTriggerExit2D` — each given the other node.
 * planck is pure JS: there is nothing to await before a scene loads.
 */

// Side effect: types the contact messages on every behaviour, wherever this package is imported.
import './contacts.js';

export { Physics2D } from './Physics2D.js';
export { Rigidbody2D, type RigidbodyType2D } from './Rigidbody2D.js';
export { type Contact2DHandlers } from './contacts.js';

// Each shape is its own class, as Unity's are. `Collider2D` is the abstract base they share.
export { Collider2D } from './Collider2D.js';
export { BoxCollider2D } from './BoxCollider2D.js';
export { CircleCollider2D } from './CircleCollider2D.js';
export { CapsuleCollider2D, type CapsuleDirection2D } from './CapsuleCollider2D.js';
export { EdgeCollider2D } from './EdgeCollider2D.js';
export { PolygonCollider2D } from './PolygonCollider2D.js';
export { ChainCollider2D } from './ChainCollider2D.js';
