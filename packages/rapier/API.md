# API

Every public signature of `@scenoco-three/rapier`. Read this instead of `src/`. Everything not here
is Rapier's own API, used directly — `Physics.world`, `rb.rapierBody`, `collider.rapierCollider` —
or three.js, as each documents it.

```ts
function initRapier(): Promise<void>;   // await initRapier() in main.ts before play(), and in a test's beforeAll

// ── messages, as hooks on any behaviour on the node: Unity's names ───────────────────────────
//   onCollisionEnter(collision: Collision)  onCollisionStay  onCollisionExit      both sides hear them
//   onTriggerEnter(other: Collider)         onTriggerStay    onTriggerExit
//   onControllerColliderHit(hit: ControllerColliderHit)

// ── bodies ─────────────────────────────────────────────────────────────────────────────────────
// <Mesh><SphereGeometry /><Rigidbody /><SphereCollider /></Mesh> — colliders on the node, and on nodes
// under it with no body of their own, make one compound body. A collider with no body is static, and
// follows its node.
class Rigidbody extends Behaviour {     // a dynamic body moves its node: set velocity or add force, not node.position
  isKinematic: boolean;                 // false. true: follows its node and pushes what it meets; may change at any time
  useGravity: boolean;                  // true
  mass: number;                         // kilograms: from the colliders' density and size until set; set, the body's
                                        // whatever its colliders — Unity's, settable every step
  linearDamping: number;                // 0
  angularDamping: number;               // 0.05. Rapier has no rolling resistance: a ball on a slope rolls on unless
                                        // this, or the game, slows it
  maxAngularVelocity: number;           // 7, radians a second
  constraints: RigidbodyConstraints;    // RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationY
  freezeRotation: boolean;              // FreezeRotation, on or off
  velocity: Vector3;                    // assign a whole vector; the value read is a frozen copy
  angularVelocity: Vector3;             // radians a second
  readonly rapierBody: RAPIER.RigidBody | null;   // from awake to onDestroy; its userData is this Rigidbody
  addForce(force: Vector3, mode?: ForceMode): void;   // ForceMode.Force by default
  addTorque(torque: Vector3, mode?: ForceMode): void;
  movePosition(position: Vector3): void;   // a teleport, world space
  moveRotation(rotation: Quaternion): void;
}
const ForceMode: { Force; Acceleration; Impulse; VelocityChange };
const RigidbodyConstraints: { None; FreezePositionX; FreezePositionY; FreezePositionZ; FreezeRotationX; FreezeRotationY;
  FreezeRotationZ; FreezePosition; FreezeRotation; FreezeAll };   // Unity's values, combined with |

// ── colliders: a size left out is fitted to the meshes on and under the node ──────────────────
abstract class Collider extends Behaviour {
  isTrigger: boolean;                   // false: reports onTrigger… instead of colliding
  center: Vector3;                      // offset from the node, before its scale
  density: number;                      // 1, kilograms a cubic metre
  layer: number;                        // 0..15 — Unity's gameObject.layer, as colliders see it
  friction: number;                     // 0 is ice
  bounciness: number;                   // 0 stops dead, 1 bounces back as high
  material: PhysicsMaterial | null;     // a surface shared with other colliders — Unity's sharedMaterial
  readonly attachedRigidbody: Rigidbody | null;   // the nearest Rigidbody on its node or above
  readonly rapierCollider: RAPIER.Collider | null;   // once started
}
class BoxCollider extends Collider { size: Vector3 }                     // the full size, as in Unity
class SphereCollider extends Collider { radius: number }
class CapsuleCollider extends Collider { radius: number; height: number }   // upright; height includes the caps
class MeshCollider extends Collider {
  sharedMesh: BufferGeometry | null;    // left out: the node's mesh
  convex: boolean;                      // false. A body that moves needs true
}
class TerrainCollider extends Collider {   // a static heightfield, on the node the Terrain is on
  terrainData: TerrainHeights | null;   // @scenoco-three/terrain's TerrainData; made again when it changes
}
interface TerrainHeights { url; isLoaded; heightmapResolution; size: Vector3; heights: Float32Array; changed: Event<[]> }
// Colliders follow their node's scale, as Unity's follow their transform.

class PhysicsMaterial {                 // made once in a .ts module: export const ice = new PhysicsMaterial({ friction: 0 })
  constructor(init?: { friction?: number; bounciness?: number; frictionCombine?: PhysicsMaterialCombine; bounceCombine?: PhysicsMaterialCombine });
  friction: number;  bounciness: number;  frictionCombine: PhysicsMaterialCombine;  bounceCombine: PhysicsMaterialCombine;
}   // a change reaches every collider using it at once
const PhysicsMaterialCombine: { Average; Minimum; Multiply; Maximum };

// ── what a contact and a query hand over ───────────────────────────────────────────────────────
class Collision {                       // the other side
  readonly node: Object3D;
  readonly collider: Collider;
  readonly rigidbody: Rigidbody | null;
  readonly impulse: Vector3;            // newton-seconds this step: on enter, its length is how hard the hit was
  readonly contacts: ContactPoint[];
  readonly contactCount: number;
  getContact(index: number): ContactPoint;
}
interface ContactPoint { point: Vector3; normal: Vector3; separation: number; thisCollider: Collider; otherCollider: Collider }
interface RaycastHit { collider: Collider; rigidbody: Rigidbody | null; node: Object3D; point: Vector3; normal: Vector3; distance: number }

// ── the world: Unity's Physics ─────────────────────────────────────────────────────────────────
class Physics {
  static readonly gravity: Vector3;     // (0, -9.81, 0): change it in place
  static readonly world: RAPIER.World | null;
  static queriesHitTriggers: boolean;
  static readonly AllLayers: number;
  static raycast(origin: Vector3, direction: Vector3, maxDistance?: number, layerMask?: number, q?: QueryTriggerInteraction): RaycastHit | null;
  static raycast(ray: Ray, maxDistance?: number, layerMask?: number, q?: QueryTriggerInteraction): RaycastHit | null;
  static raycastAll(origin: Vector3, direction: Vector3, maxDistance?: number, layerMask?: number, q?: QueryTriggerInteraction): RaycastHit[];   // nearest first
  static sphereCast(origin: Vector3, radius: number, direction: Vector3, maxDistance?: number, layerMask?: number, q?: QueryTriggerInteraction): RaycastHit | null;
  static overlapSphere(position: Vector3, radius: number, layerMask?: number, q?: QueryTriggerInteraction): Collider[];
  static overlapBox(center: Vector3, halfExtents: Vector3, orientation?: Quaternion, layerMask?: number, q?: QueryTriggerInteraction): Collider[];
  static checkSphere(position: Vector3, radius: number, layerMask?: number, q?: QueryTriggerInteraction): boolean;   // a ground check
  static ignoreLayerCollision(layer1: number, layer2: number, ignore?: boolean): void;
  static getIgnoreLayerCollision(layer1: number, layer2: number): boolean;
  colliderOf(collider: RAPIER.Collider | number): Collider | null;   // back from Rapier's API: service(node, Physics).colliderOf(hit.collider)
}
const QueryTriggerInteraction: { UseGlobal; Ignore; Collide };

// ── a character: Unity's CharacterController ───────────────────────────────────────────────────
class CharacterController extends Collider {   // a capsule moved only by move or simpleMove
  slopeLimit: number;                   // 45, degrees
  stepOffset: number;                   // 0.3, metres
  skinWidth: number;                    // 0.08
  minMoveDistance: number;              // 0.001
  radius: number;                       // 0.5
  height: number;                       // 2, caps included
  readonly isGrounded: boolean;
  readonly collisionFlags: CollisionFlags;
  readonly velocity: Vector3;           // how fast the last move really went
  move(motion: Vector3): CollisionFlags;   // metres, world space, this frame's share: speed times Time.deltaTime
  simpleMove(speed: Vector3): boolean;  // metres a second, gravity added: once a frame
}
const CollisionFlags: { None; Sides; Above; Below };
interface ControllerColliderHit { controller; collider: Collider; rigidbody: Rigidbody | null; node: Object3D;
  point: Vector3; normal: Vector3; moveDirection: Vector3; moveLength: number }

// ── joints: Unity's, made in start as the two bodies stand ─────────────────────────────────────
abstract class Joint extends Behaviour {
  connectedBody: Rigidbody | null;      // null: a point fixed in the world
  anchor: Vector3;                      // in this node's space
  enableCollision: boolean;             // false
  readonly rapierJoint: RAPIER.ImpulseJoint | null;
}
class FixedJoint extends Joint {}       // glued
class HingeJoint extends Joint {        // a door, a wheel, a lever
  axis: Vector3;                        // (1, 0, 0), this node's space
  useLimits: boolean;  limits: JointLimits;   // degrees from where it started
  useMotor: boolean;   motor: JointMotor;
}
class SpringJoint extends Joint { spring: number; damper: number }   // 10, 0.2: back to the distance it started at
interface JointLimits { min: number; max: number }
interface JointMotor { targetVelocity: number; force: number }   // degrees a second
```
