import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3, type Object3D } from 'three';
import { Runtime, System, sendMessage, service } from '@scenoco-three/core';
import type { Collider } from './colliders.js';
import type { Rigidbody } from './Rigidbody.js';

/** What `onCollisionEnter` / `onCollisionExit` receive — Unity's `Collision`: the other side. */
export interface Collision {
  /** The other object. */
  node: Object3D;
  /** The other object's collider that touched. */
  collider: Collider;
  /** The other object's body, or null when it is a static collider. */
  rigidbody: Rigidbody | null;
}

/**
 * The physics world, on Rapier — Unity's `Physics`. Made by the first `Rigidbody` or collider
 * that wakes; nothing has to declare it. `Physics.gravity.set(0, -20, 0)` changes gravity, and
 * `Physics.world` is Rapier's own world for anything the components do not expose.
 *
 * Each `fixedUpdate`, after every behaviour's: kinematic bodies follow their nodes, the world
 * steps, dynamic bodies write back, and only then are contacts sent — so a handler may destroy
 * freely without touching the world mid-step.
 */
export class Physics extends System {
  /** Gravity, in metres per second squared — Unity's `Physics.gravity`. Read every step. */
  static readonly gravity = new Vector3(0, -9.81, 0);

  /** The running scene's Rapier world — raycasts, shape casts, joints — or null before any body exists. */
  static get world(): RAPIER.World | null {
    const root = Runtime.current?.root;
    return root ? service(root, Physics).world : null;
  }

  /** @internal this scene's Rapier world. */
  world!: RAPIER.World;

  private events!: RAPIER.EventQueue;
  private readonly bodies = new Set<Rigidbody>();
  /** Per dynamic body: its last two fixed poses, which `update` blends between. */
  private readonly poses = new Map<Rigidbody, Pose>();
  /** Rapier collider handle → collider, to turn a contact event back into objects. */
  private readonly colliders = new Map<number, Collider>();
  /** Handles removed since the last step: still named by that step's exit events. */
  private readonly retired: number[] = [];
  /** Colliders with no body: placed where their node is, and moved when it moves, as in Unity. */
  private readonly statics = new Set<Collider>();
  private readonly contacts: { a: Collider; b: Collider; started: boolean }[] = [];
  /** Pairs touching now, by handle. A collider that goes away ends its pairs itself, at once. */
  private readonly touching = new Map<string, { a: Collider; b: Collider; ha: number; hb: number }>();

  override awake(): void {
    if (typeof RAPIER.World !== 'function') {
      throw new Error('Rapier is not loaded: `await initRapier()` before the scene renders — it is WebAssembly.');
    }
    this.world = new RAPIER.World(Physics.gravity);
    this.events = new RAPIER.EventQueue(true);
  }

  override onDestroy(): void {
    for (const rigidbody of this.bodies) rigidbody._body = null;
    for (const collider of this.colliders.values()) collider._collider = null;
    this.touching.clear();
    this.statics.clear();
    this.events.free();
    this.world.free();
  }

  // --- membership: bodies and colliders join in their hooks, nothing is rediscovered --------

  /** @internal */
  createBody(rigidbody: Rigidbody): RAPIER.RigidBody {
    const node = rigidbody.node;
    const p = node.getWorldPosition(SCRATCH_V);
    const q = node.getWorldQuaternion(SCRATCH_Q);
    const desc = (rigidbody.isKinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(rigidbody.linearDamping)
      .setAngularDamping(rigidbody.angularDamping)
      .setGravityScale(rigidbody.useGravity ? 1 : 0);
    if (rigidbody.freezeRotation) desc.lockRotations();
    const body = this.world.createRigidBody(desc);
    body.userData = rigidbody; // Rapier's own place for it, so `hit.collider.parent()?.userData` works too
    this.bodies.add(rigidbody);
    if (!rigidbody.isKinematic) this.poses.set(rigidbody, poseOf(body));
    return body;
  }

  /** @internal */
  destroyBody(rigidbody: Rigidbody): void {
    const body = rigidbody._body;
    if (body) {
      for (let i = 0; i < body.numColliders(); i++) this.endContacts(body.collider(i).handle);
      this.world.removeRigidBody(body);
    }
    this.bodies.delete(rigidbody);
    this.poses.delete(rigidbody);
  }

  /** @internal On the body when there is one; otherwise a static collider where its node is, as in Unity. */
  createCollider(collider: Collider, body: RAPIER.RigidBody | null): RAPIER.Collider {
    const node = collider.node;
    const scale = node.getWorldScale(new Vector3());
    const desc = collider
      .shape(scale)
      .setFriction(collider.friction)
      .setRestitution(collider.bounciness)
      .setDensity(collider.density)
      .setSensor(collider.isTrigger)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      // Unity reports a trigger against anything with a body, kinematic included; Rapier's default does not.
      .setActiveCollisionTypes(collider.isTrigger ? RAPIER.ActiveCollisionTypes.ALL : RAPIER.ActiveCollisionTypes.DEFAULT);
    const center = SCRATCH_V.copy(collider.center).multiply(scale);
    if (body) {
      desc.setTranslation(center.x, center.y, center.z);
    } else {
      const { p, q } = staticPose(collider, scale);
      desc.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      this.statics.add(collider);
    }
    const created = this.world.createCollider(desc, body ?? undefined);
    this.colliders.set(created.handle, collider);
    return created;
  }

  /** @internal */
  destroyCollider(created: RAPIER.Collider): void {
    const collider = this.colliders.get(created.handle);
    if (collider) this.statics.delete(collider);
    this.endContacts(created.handle);
    this.world.removeCollider(created, true);
  }

  /**
   * The collider behind a Rapier collider or its handle — how a raycast, shape cast or contact
   * found through Rapier's API comes back to an object: `physics.colliderOf(hit.collider)?.node`.
   */
  colliderOf(collider: RAPIER.Collider | number): Collider | null {
    return this.colliders.get(typeof collider === 'number' ? collider : collider.handle) ?? null;
  }

  /** @internal a teleport: forget the previous pose, so nothing blends across the jump. */
  resetPose(rigidbody: Rigidbody): void {
    if (rigidbody._body && this.poses.has(rigidbody)) this.poses.set(rigidbody, poseOf(rigidbody._body));
  }

  // --- the step ------------------------------------------------------------------------------

  override fixedUpdate(dt: number): void {
    // A kinematic body follows its node — unless code drove it the Rapier way this step
    // (`setNextKinematicTranslation`), and then the node follows the body instead.
    const drivenByBody: Rigidbody[] = [];
    for (const rigidbody of this.bodies) {
      const body = rigidbody._body;
      if (!rigidbody.isKinematic || !body || !rigidbody.enabled) continue;
      if (moving(body)) {
        drivenByBody.push(rigidbody);
        continue;
      }
      body.setNextKinematicTranslation(rigidbody.node.getWorldPosition(SCRATCH_V));
      body.setNextKinematicRotation(rigidbody.node.getWorldQuaternion(SCRATCH_Q));
    }

    // A static collider moved through its node — a scrolling obstacle, a sliding door — goes with it.
    for (const collider of this.statics) {
      const created = collider._collider;
      if (!created || !collider.enabled) continue;
      const { p, q } = staticPose(collider, collider.node.getWorldScale(SCALE));
      const t = created.translation();
      const r = created.rotation();
      // Rapier keeps f32, so compare with a tolerance: an unmoved wall is not touched.
      if (Math.abs(t.x - p.x) + Math.abs(t.y - p.y) + Math.abs(t.z - p.z) > 1e-4) created.setTranslation(p);
      if (Math.abs(r.x - q.x) + Math.abs(r.y - q.y) + Math.abs(r.z - q.z) + Math.abs(r.w - q.w) > 1e-6) created.setRotation(q);
    }

    this.world.gravity = Physics.gravity;
    this.world.timestep = dt;
    this.world.step(this.events);

    this.events.drainCollisionEvents((h1, h2, started) => {
      if (this.retired.includes(h1) || this.retired.includes(h2)) return; // already ended by endContacts
      const a = this.colliders.get(h1);
      const b = this.colliders.get(h2);
      if (!a || !b) return this.reportForeign(a ? h2 : h1);
      const key = pairKey(h1, h2);
      if (started) this.touching.set(key, { a, b, ha: h1, hb: h2 });
      else if (!this.touching.delete(key)) return;
      this.contacts.push({ a, b, started });
    });
    for (const handle of this.retired) this.colliders.delete(handle);
    this.retired.length = 0;

    for (const [rigidbody, pose] of this.poses) if (rigidbody._body) advance(pose, rigidbody._body, dt);
    for (const rigidbody of drivenByBody) {
      const t = rigidbody._body!.translation();
      const r = rigidbody._body!.rotation();
      applyWorldPose(rigidbody.node, BLEND_V.set(t.x, t.y, t.z), BLEND_Q.set(r.x, r.y, r.z, r.w));
    }

    for (const { a, b, started } of this.contacts.splice(0)) dispatch(a, b, started);
  }

  /**
   * A collider is going away — destroyed, disabled, or its body is. Its pairs end now, while both
   * objects still have their nodes; Rapier's own events for them arrive next step and are dropped.
   */
  private endContacts(handle: number): void {
    this.retired.push(handle);
    for (const [key, pair] of this.touching) {
      if (pair.ha !== handle && pair.hb !== handle) continue;
      this.touching.delete(key);
      dispatch(pair.a, pair.b, false);
    }
  }

  private reported = false;

  /** A collider made with Rapier's API directly is real to Rapier, and invisible to everything here. */
  private reportForeign(handle: number): void {
    if (this.reported || this.retired.includes(handle)) return;
    this.reported = true;
    console.warn(
      'A collider created with Rapier\'s API directly touched something. It gets no messages and moves no ' +
        'object: make bodies and colliders with <Rigidbody /> and <BoxCollider /> & co., and use Rapier for queries and joints.',
    );
  }

  /** Dynamic bodies are drawn between their last two fixed poses, so motion is smooth at any frame rate. */
  override update(): void {
    const t = Math.min(this.runtime.interpolationAlpha, 1);
    for (const [rigidbody, pose] of this.poses) {
      if (!rigidbody.enabled) continue;
      applyWorldPose(rigidbody.node, BLEND_V.lerpVectors(pose.previous, pose.position, t), BLEND_Q.slerpQuaternions(pose.previousRotation, pose.rotation, t));
    }
  }
}

/** Where a static collider's shape sits in the world: its node's pose, offset by `center`. */
function staticPose(collider: Collider, scale: Vector3): { p: Vector3; q: Quaternion } {
  const q = collider.node.getWorldQuaternion(STATIC_Q);
  const p = STATIC_V.copy(collider.center).multiply(scale).applyQuaternion(q).add(collider.node.getWorldPosition(SCRATCH_V));
  return { p, q };
}

function moving(body: RAPIER.RigidBody): boolean {
  const t = body.translation();
  const n = body.nextTranslation();
  const r = body.rotation();
  const m = body.nextRotation();
  return t.x !== n.x || t.y !== n.y || t.z !== n.z || r.x !== m.x || r.y !== m.y || r.z !== m.z || r.w !== m.w;
}

/** Both sides hear it, each about the other — Unity's messages, Unity's payloads. */
function dispatch(a: Collider, b: Collider, started: boolean): void {
  if (a.isTrigger || b.isTrigger) {
    const name = started ? 'onTriggerEnter' : 'onTriggerExit';
    sendMessage(a.node, name, b);
    sendMessage(b.node, name, a);
  } else {
    const name = started ? 'onCollisionEnter' : 'onCollisionExit';
    sendMessage(a.node, name, collisionWith(b));
    sendMessage(b.node, name, collisionWith(a));
  }
}

function pairKey(h1: number, h2: number): string {
  return h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
}

function collisionWith(other: Collider): Collision {
  return { node: other.node, collider: other, rigidbody: other.attachedRigidbody };
}

interface Pose {
  previous: Vector3;
  previousRotation: Quaternion;
  position: Vector3;
  rotation: Quaternion;
}

function poseOf(body: RAPIER.RigidBody): Pose {
  const t = body.translation();
  const r = body.rotation();
  return {
    previous: new Vector3(t.x, t.y, t.z),
    previousRotation: new Quaternion(r.x, r.y, r.z, r.w),
    position: new Vector3(t.x, t.y, t.z),
    rotation: new Quaternion(r.x, r.y, r.z, r.w),
  };
}

/** Shift current → previous. A jump far beyond the body's speed is a teleport, and is not blended. */
function advance(pose: Pose, body: RAPIER.RigidBody, dt: number): void {
  const t = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  const moved = Math.hypot(t.x - pose.position.x, t.y - pose.position.y, t.z - pose.position.z);
  const teleported = moved > Math.hypot(v.x, v.y, v.z) * dt * 4 + 0.1;
  if (teleported) {
    pose.previous.set(t.x, t.y, t.z);
    pose.previousRotation.set(r.x, r.y, r.z, r.w);
  } else {
    pose.previous.copy(pose.position);
    pose.previousRotation.copy(pose.rotation);
  }
  pose.position.set(t.x, t.y, t.z);
  pose.rotation.set(r.x, r.y, r.z, r.w);
}

/** A body's pose is a world pose; put it back through whatever the node hangs under. */
function applyWorldPose(node: Object3D, position: Vector3, rotation: Quaternion): void {
  const parent = node.parent;
  if (!parent) {
    node.position.copy(position);
    node.quaternion.copy(rotation);
    return;
  }
  parent.updateWorldMatrix(true, false);
  node.position.copy(parent.worldToLocal(SCRATCH_V.copy(position)));
  node.quaternion.copy(parent.getWorldQuaternion(SCRATCH_Q).invert().multiply(rotation));
}

const SCRATCH_V = new Vector3();
const SCRATCH_Q = new Quaternion();
const BLEND_V = new Vector3();
const BLEND_Q = new Quaternion();
const STATIC_V = new Vector3();
const STATIC_Q = new Quaternion();
const SCALE = new Vector3();
