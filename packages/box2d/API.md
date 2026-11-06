# API

Every public signature of `@scenoco-three/box2d`. Read this instead of `src/`. It runs on planck, a
pure-JS Box2D: everything not here is planck's own API — `Physics2D.world`, `rb.planckBody`,
`collider.planckFixtures`, `joint.planckJoint` — or three.js, as each documents it.

```ts
// 2D physics in the XY plane: a body drives its node's x, y and rotation.z, and leaves z for depth.
// Angles are degrees, counter-clockwise, as Unity's 2D angles are.

// ── messages, as hooks on any behaviour on the node: Unity's names ───────────────────────────
//   onCollisionEnter2D(collision: Collision2D)  onCollisionStay2D  onCollisionExit2D    both sides hear them
//   onTriggerEnter2D(other: Collider2D)         onTriggerStay2D    onTriggerExit2D
//   onJointBreak2D(joint: Joint2D)              past breakForce or breakTorque; the joint is destroyed after

// ── bodies ─────────────────────────────────────────────────────────────────────────────────────
// <Mesh><Rigidbody2D /><CircleCollider2D radius={0.5} /></Mesh> — colliders on the node, and on nodes
// under it with no body of their own, make one body. A collider with no body is static.
class Rigidbody2D extends Behaviour {
  bodyType: RigidbodyType2D;            // Dynamic: forces, gravity, hits. Kinematic: moved by the game, pushes dynamic
                                        // bodies. Static: never moves
  mass: number;                         // 1 kilogram, whatever the colliders' size — unless useAutoMass
  useAutoMass: boolean;                 // false. true: mass from the colliders' area and density
  gravityScale: number;                 // 1; 0 floats
  linearDamping: number;                // 0
  angularDamping: number;               // 0.05
  constraints: RigidbodyConstraints2D;  // RigidbodyConstraints2D.FreezeRotation | RigidbodyConstraints2D.FreezePositionX
  freezeRotation: boolean;
  collisionDetectionMode: CollisionDetectionMode2D;   // Continuous for a bullet or a ball fast enough to pass a wall in a step
  linearVelocity: Vector2;              // metres a second, world space
  angularVelocity: number;              // degrees a second
  position: Vector2;                    // in the world
  rotation: number;                     // degrees, in the world
  readonly planckBody: Body | null;     // from awake to onDestroy
  addForce(force: Vector2, mode?: ForceMode2D): void;           // ForceMode2D.Force over this step, or Impulse at once
  addForceAtPosition(force: Vector2, position: Vector2, mode?: ForceMode2D): void;   // off centre, it turns too
  addTorque(torque: number, mode?: ForceMode2D): void;          // counter-clockwise for a positive torque
  movePosition(position: Vector2): void;   // over the next step: a kinematic body pushes what is in the way
  moveRotation(angle: number): void;
  isAwake(): boolean;  isSleeping(): boolean;  sleep(): void;  wakeUp(): void;
}
const RigidbodyType2D: { Dynamic; Kinematic; Static };
const RigidbodyConstraints2D: { None; FreezePositionX; FreezePositionY; FreezeRotation; FreezePosition; FreezeAll };   // combined with |
const ForceMode2D: { Force; Impulse };
const CollisionDetectionMode2D: { Discrete; Continuous };

// ── colliders: a size left out is fitted to the meshes on and under the node ──────────────────
abstract class Collider2D extends Behaviour {
  isTrigger: boolean;                   // false: reports onTrigger…2D instead of colliding
  offset: Vector2;                      // on its node, before scale
  density: number;                      // kilograms a square metre, with useAutoMass
  layer: number;                        // 0..15
  friction: number;                     // 0 is ice
  bounciness: number;                   // 0 stops dead, 1 bounces back as high
  material: PhysicsMaterial2D | null;   // a surface shared with other colliders — Unity's sharedMaterial
  readonly attachedRigidbody: Rigidbody2D | null;   // the nearest Rigidbody2D on its node or above
  readonly planckFixtures: readonly Fixture[];      // more than one for a concave polygon
}
class BoxCollider2D extends Collider2D { size: Vector2 }               // full size, not half
class CircleCollider2D extends Collider2D { radius: number }
class CapsuleCollider2D extends Collider2D { size: Vector2; direction: CapsuleDirection2D }   // round ends along direction
class PolygonCollider2D extends Collider2D { points: Vector2[] }       // an outline in order, convex or not
class EdgeCollider2D extends Collider2D { points: Vector2[] }          // a line: ground, a track
const CapsuleDirection2D: { Vertical; Horizontal };
class PhysicsMaterial2D {               // made once in a .ts module: export const ice = new PhysicsMaterial2D({ friction: 0 })
  constructor(init?: { friction?: number; bounciness?: number });
  friction: number;  bounciness: number;
}

// ── what a contact and a query hand over ───────────────────────────────────────────────────────
class Collision2D {                     // the other side, and where and how hard
  readonly node: Object3D;              // the other collider's node — Unity's collision.gameObject
  readonly collider: Collider2D;        // the other collider
  readonly otherCollider: Collider2D;   // this side's
  readonly rigidbody: Rigidbody2D | null;
  readonly otherRigidbody: Rigidbody2D | null;
  readonly relativeVelocity: Vector2;   // the other's velocity minus this one's, as they met
  readonly contacts: ContactPoint2D[];
  readonly contactCount: number;
  getContact(index: number): ContactPoint2D;
}
interface ContactPoint2D { point: Vector2; normal: Vector2; separation: number; normalImpulse: number; collider: Collider2D; otherCollider: Collider2D }
interface RaycastHit2D { collider: Collider2D; rigidbody: Rigidbody2D | null; node: Object3D; point: Vector2; normal: Vector2; distance: number; fraction: number }

// ── the world: Unity's Physics2D ───────────────────────────────────────────────────────────────
class Physics2D {
  static readonly gravity: Vector2;     // (0, -9.81): change it in place
  static velocityIterations: number;    // 8
  static positionIterations: number;    // 3
  static queriesHitTriggers: boolean;
  static queriesStartInColliders: boolean;
  static readonly AllLayers: number;
  static readonly world: World | null;
  static raycast(origin: Vector2, direction: Vector2, distance?: number, layerMask?: number): RaycastHit2D | null;
  static raycastAll(origin: Vector2, direction: Vector2, distance?: number, layerMask?: number): RaycastHit2D[];   // nearest first
  static overlapPoint(point: Vector2, layerMask?: number): Collider2D | null;
  static overlapCircle(point: Vector2, radius: number, layerMask?: number): Collider2D | null;
  static overlapCircleAll(point: Vector2, radius: number, layerMask?: number): Collider2D[];
  static overlapBox(point: Vector2, size: Vector2, angle?: number, layerMask?: number): Collider2D | null;
  static overlapBoxAll(point: Vector2, size: Vector2, angle?: number, layerMask?: number): Collider2D[];
  static ignoreLayerCollision(layer1: number, layer2: number, ignore?: boolean): void;
  static getIgnoreLayerCollision(layer1: number, layer2: number): boolean;
}

// ── joints: Unity's nine, on the node with the Rigidbody2D; connectedBody null is the world ──
abstract class Joint2D extends Behaviour {
  connectedBody: Rigidbody2D | null;    // <WheelJoint2D connectedBody={wheel} />, with <Rigidbody2D ref={wheel} /> on the wheel
  enableCollision: boolean;
  breakForce: number;  breakTorque: number;   // Infinity: never breaks
  readonly attachedRigidbody: Rigidbody2D | null;
  readonly reactionForce: Vector2;  readonly reactionTorque: number;   // the last step's
  getReactionForce(timeStep: number): Vector2;  getReactionTorque(timeStep: number): number;
  readonly planckJoint: Joint | null;
}
abstract class AnchoredJoint2D extends Joint2D {
  anchor: Vector2;                      // on this body, in its node's space
  connectedAnchor: Vector2;             // on the connected body, in its node's space — or in the world, with none
  autoConfigureConnectedAnchor: boolean;
}
class FixedJoint2D extends AnchoredJoint2D { frequency: number; dampingRatio: number; readonly referenceAngle: number }   // glued; springy with a frequency
class HingeJoint2D extends AnchoredJoint2D {   // a door, a flipper, a pendulum
  useLimits: boolean;  limits: JointAngleLimits2D;
  useMotor: boolean;   motor: JointMotor2D;
  readonly jointAngle: number;  readonly jointSpeed: number;
  getMotorTorque(timeStep: number): number;
}
class DistanceJoint2D extends AnchoredJoint2D {   // a rod, or with maxDistanceOnly a rope
  autoConfigureDistance: boolean;  distance: number;  maxDistanceOnly: boolean;
}
class SpringJoint2D extends AnchoredJoint2D { autoConfigureDistance: boolean; distance: number; dampingRatio: number; frequency: number }
class SliderJoint2D extends AnchoredJoint2D {   // along one line, without turning: a lift, a piston
  angle: number;  autoConfigureAngle: boolean;
  useLimits: boolean;  limits: JointTranslationLimits2D;
  useMotor: boolean;   motor: JointMotor2D;
  readonly jointTranslation: number;  readonly jointSpeed: number;
}
class WheelJoint2D extends AnchoredJoint2D {    // on the car's body, the wheel as connectedBody
  suspension: JointSuspension2D;
  useMotor: boolean;  motor: JointMotor2D;
  readonly jointTranslation: number;  readonly jointAngularSpeed: number;
  getMotorTorque(timeStep: number): number;
}
class FrictionJoint2D extends AnchoredJoint2D { maxForce: number; maxTorque: number }   // top-down drag
class RelativeJoint2D extends Joint2D {         // holds the connected body at an offset: a follower
  maxForce: number;  maxTorque: number;  correctionScale: number;
  autoConfigureOffset: boolean;  linearOffset: Vector2;  angularOffset: number;
}
class TargetJoint2D extends Joint2D {           // pulls anchor towards target in the world: dragging with the pointer
  anchor: Vector2;  target: Vector2;  autoConfigureTarget: boolean;
  maxForce: number;  dampingRatio: number;  frequency: number;
}
interface JointMotor2D { motorSpeed: number; maxMotorTorque: number }       // degrees a second, or metres for a slider
interface JointAngleLimits2D { min: number; max: number }                   // degrees from where it started
interface JointTranslationLimits2D { min: number; max: number }             // metres
interface JointSuspension2D { dampingRatio: number; frequency: number; angle: number }
```
