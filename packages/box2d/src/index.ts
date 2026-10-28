/**
 * `@scenoco-three/box2d` — 2D physics on planck (a pure-JS Box2D), in Unity's shape: `Rigidbody2D`,
 * the 2D colliders, `PhysicsMaterial2D`, `Physics2D`'s queries and layers, and the contact messages.
 *
 * ```tsx
 * <Mesh position={[0, 5, 0]}>
 *   <CircleGeometry args={[0.3]} />
 *   <Rigidbody2D collisionDetectionMode={CollisionDetectionMode2D.Continuous} />
 *   <CircleCollider2D bounciness={1} />
 * </Mesh>
 * ```
 *
 * The simulation runs in the XY plane: a body drives its node's x, y and `rotation.z`, and z is left
 * for depth. planck is plain JavaScript: there is nothing to await before a scene loads.
 */
import { declareMessages } from '@scenoco-three/core';
import type { Collider2D } from './Collider2D.js';
import type { Collision2D } from './Collision2D.js';
import type { Joint2D } from './joints.js';

// The hooks exist — typed — only where this package is imported.
declare module '@scenoco-three/core' {
  interface BehaviourHooks {
    /** A solid contact with another collider began. */
    onCollisionEnter2D?(collision: Collision2D): void;
    /** Every physics step while the contact lasts, after the one it began in. */
    onCollisionStay2D?(collision: Collision2D): void;
    onCollisionExit2D?(collision: Collision2D): void;
    /** Another collider entered this trigger, or this collider entered its trigger. */
    onTriggerEnter2D?(other: Collider2D): void;
    onTriggerStay2D?(other: Collider2D): void;
    onTriggerExit2D?(other: Collider2D): void;
    /** A joint on this node broke, past its `breakForce` or `breakTorque`; it is destroyed after. */
    onJointBreak2D?(joint: Joint2D): void;
  }
}
declareMessages(['onCollisionEnter2D', 'onCollisionStay2D', 'onCollisionExit2D', 'onTriggerEnter2D', 'onTriggerStay2D', 'onTriggerExit2D', 'onJointBreak2D']);

export { Physics2D } from './Physics2D.js';
export { Rigidbody2D, RigidbodyType2D, RigidbodyConstraints2D, ForceMode2D, CollisionDetectionMode2D } from './Rigidbody2D.js';
export { PhysicsMaterial2D } from './PhysicsMaterial2D.js';
export { Collision2D, type ContactPoint2D, type RaycastHit2D } from './Collision2D.js';
export { Collider2D } from './Collider2D.js';
export { BoxCollider2D } from './BoxCollider2D.js';
export { CircleCollider2D } from './CircleCollider2D.js';
export { CapsuleCollider2D, CapsuleDirection2D } from './CapsuleCollider2D.js';
export { EdgeCollider2D } from './EdgeCollider2D.js';
export { PolygonCollider2D } from './PolygonCollider2D.js';
export {
  Joint2D,
  AnchoredJoint2D,
  FixedJoint2D,
  HingeJoint2D,
  DistanceJoint2D,
  SpringJoint2D,
  SliderJoint2D,
  WheelJoint2D,
  FrictionJoint2D,
  RelativeJoint2D,
  TargetJoint2D,
  type JointMotor2D,
  type JointAngleLimits2D,
  type JointTranslationLimits2D,
  type JointSuspension2D,
} from './joints.js';
