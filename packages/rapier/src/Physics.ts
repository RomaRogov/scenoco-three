import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Ray, Vector3, type Object3D } from 'three';
import { Runtime, System, sendMessage, service } from '@scenoco-three/core';
import type { Collider } from './colliders.js';
import type { Rigidbody } from './Rigidbody.js';

/** One point where two colliders touch — Unity's `ContactPoint`. */
export interface ContactPoint {
  /** Where, in world space. */
  point: Vector3;
  /** Out of the other collider, towards this one. */
  normal: Vector3;
  /** How far apart the two surfaces are there: negative while they overlap. */
  separation: number;
  thisCollider: Collider;
  otherCollider: Collider;
}

/** What `onCollisionEnter` / `onCollisionStay` / `onCollisionExit` receive — Unity's `Collision`: the other side. */
export class Collision {
  /** The other object: the node of the collider that touched. */
  readonly node: Object3D;
  /** The other object's collider that touched. */
  readonly collider: Collider;
  /** The other object's body, or null when it is a static collider. */
  readonly rigidbody: Rigidbody | null;
  /**
   * The impulse that pushed the two apart this step, in newton-seconds — Unity's
   * `collision.impulse`: on enter, its length says how hard the hit was. Zero on exit.
   */
  readonly impulse: Vector3;
  private readonly self: Collider;
  private readonly world: RAPIER.World | null;
  private _contacts: ContactPoint[] | null = null;

  /** @internal */
  constructor(other: Collider, impulse: Vector3, self: Collider, world: RAPIER.World | null) {
    this.node = other.node;
    this.collider = other;
    this.rigidbody = other.attachedRigidbody;
    this.impulse = impulse;
    this.self = self;
    this.world = world;
  }

  /** Where the two touch now — Unity's `collision.contacts`. Empty on exit. */
  get contacts(): ContactPoint[] {
    return (this._contacts ??= this.world ? contactsBetween(this.world, this.self, this.collider) : []);
  }

  /** Unity's `collision.contactCount`. */
  get contactCount(): number {
    return this.contacts.length;
  }

  /** Unity's `collision.GetContact(i)`. */
  getContact(index: number): ContactPoint {
    const contact = this.contacts[index];
    if (!contact) throw new RangeError(`Collision.getContact(${index}): it has ${this.contactCount} contact${this.contactCount === 1 ? '' : 's'}.`);
    return contact;
  }
}

/** A query's hit — Unity's `RaycastHit`. */
export interface RaycastHit {
  collider: Collider;
  /** The collider's body, or null for a static collider. */
  rigidbody: Rigidbody | null;
  /** The collider's node. */
  node: Object3D;
  /** Where it was hit, in world space. */
  point: Vector3;
  /** The surface's normal there, out of the collider. */
  normal: Vector3;
  /** From the query's origin to `point` — for a sphere cast, how far the sphere travelled. */
  distance: number;
}

/** Whether a query hits triggers — Unity's `QueryTriggerInteraction`. */
export const QueryTriggerInteraction = {
  /** As `Physics.queriesHitTriggers` says. The default. */
  UseGlobal: 0,
  Ignore: 1,
  Collide: 2,
} as const;
export type QueryTriggerInteraction = (typeof QueryTriggerInteraction)[keyof typeof QueryTriggerInteraction];

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

  /**
   * Whether colliders on these two layers pass through each other — Unity's
   * `Physics.IgnoreLayerCollision`: no contact, no trigger, no messages. Layers are 0 to 15, Rapier's
   * collision groups. Colliders already made take it at the next step.
   */
  static ignoreLayerCollision(layer1: number, layer2: number, ignore = true): void {
    for (const [a, b] of [[layer1, layer2], [layer2, layer1]] as const) {
      checkLayer(a);
      if (ignore) ignoredLayers[a]! |= 1 << b;
      else ignoredLayers[a]! &= ~(1 << b);
    }
    layersChanged++;
  }

  /** Whether `ignoreLayerCollision` has these two layers pass through each other — Unity's `Physics.GetIgnoreLayerCollision`. */
  static getIgnoreLayerCollision(layer1: number, layer2: number): boolean {
    checkLayer(layer1);
    checkLayer(layer2);
    return (ignoredLayers[layer1]! & (1 << layer2)) !== 0;
  }

  /** The running scene's Rapier world — Rapier's own API, for anything these do not cover. */
  static get world(): RAPIER.World | null {
    return Physics.running()?.world ?? null;
  }

  /** Whether queries hit triggers when they do not say — Unity's `Physics.queriesHitTriggers`. */
  static queriesHitTriggers = true;

  /** Every layer, for a query's `layerMask` — Unity's `Physics.AllLayers`. One layer is `1 << layer`. */
  static readonly AllLayers = 0xffff;

  /**
   * The first collider a ray meets — Unity's `Physics.Raycast`, returning the hit or null. The ray is
   * an origin and a direction, or three's `Ray`: through the pointer, `new Raycaster()` and
   * `setFromCamera(Input.pointer, this.camera)` make it. It sees bodies where the last physics step left them.
   */
  static raycast(origin: Vector3, direction: Vector3, maxDistance?: number, layerMask?: number, queryTriggerInteraction?: QueryTriggerInteraction): RaycastHit | null;
  static raycast(ray: Ray, maxDistance?: number, layerMask?: number, queryTriggerInteraction?: QueryTriggerInteraction): RaycastHit | null;
  static raycast(...args: RayArgs): RaycastHit | null {
    const physics = Physics.running();
    if (!physics) return null;
    const { ray, length, mask, triggers } = rayOf(args);
    const hit = physics.world.castRayAndGetNormal(ray, length, true, filterFlags(triggers), undefined, undefined, undefined, physics.filter(mask));
    return hit ? physics.hitOf(hit.collider, ray, hit.timeOfImpact, hit.normal) : null;
  }

  /** Every collider a ray meets, nearest first — Unity's `Physics.RaycastAll`. */
  static raycastAll(origin: Vector3, direction: Vector3, maxDistance?: number, layerMask?: number, queryTriggerInteraction?: QueryTriggerInteraction): RaycastHit[];
  static raycastAll(ray: Ray, maxDistance?: number, layerMask?: number, queryTriggerInteraction?: QueryTriggerInteraction): RaycastHit[];
  static raycastAll(...args: RayArgs): RaycastHit[] {
    const physics = Physics.running();
    if (!physics) return [];
    const { ray, length, mask, triggers } = rayOf(args);
    const hits: RaycastHit[] = [];
    physics.world.intersectionsWithRay(ray, length, true, (hit) => {
      const found = physics.hitOf(hit.collider, ray, hit.timeOfImpact, hit.normal);
      if (found) hits.push(found);
      return true;
    }, filterFlags(triggers), undefined, undefined, undefined, physics.filter(mask));
    return hits.sort((a, b) => a.distance - b.distance);
  }

  /**
   * The first collider a sphere swept along a ray meets — Unity's `Physics.SphereCast`, a thick
   * raycast. A collider the sphere already overlaps at the start is not hit, as in Unity.
   */
  static sphereCast(origin: Vector3, radius: number, direction: Vector3, maxDistance = Infinity, layerMask = Physics.AllLayers, queryTriggerInteraction: QueryTriggerInteraction = QueryTriggerInteraction.UseGlobal): RaycastHit | null {
    const physics = Physics.running();
    if (!physics) return null;
    const dir = QUERY_V.copy(direction).normalize();
    const ball = new RAPIER.Ball(radius);
    const hit = physics.world.castShape(origin, IDENTITY, dir, ball, 0, finite(maxDistance), false, filterFlags(queryTriggerInteraction), undefined, undefined, undefined, physics.filter(layerMask));
    if (!hit) return null;
    const collider = physics.colliders.get(hit.collider.handle);
    if (!collider) return null;
    // The first witness and normal are the hit collider's, in world space.
    const w = hit.witness1;
    const n = hit.normal1;
    return {
      collider,
      rigidbody: collider.attachedRigidbody,
      node: collider.node,
      point: new Vector3(w.x, w.y, w.z),
      normal: new Vector3(n.x, n.y, n.z),
      distance: hit.time_of_impact,
    };
  }

  /** The colliders touching or inside a sphere — Unity's `Physics.OverlapSphere`. */
  static overlapSphere(position: Vector3, radius: number, layerMask = Physics.AllLayers, queryTriggerInteraction: QueryTriggerInteraction = QueryTriggerInteraction.UseGlobal): Collider[] {
    return Physics.overlap(position, IDENTITY, new RAPIER.Ball(radius), layerMask, queryTriggerInteraction);
  }

  /** The colliders touching or inside a box — Unity's `Physics.OverlapBox`, with half its size on each axis. */
  static overlapBox(center: Vector3, halfExtents: Vector3, orientation: Quaternion = new Quaternion(), layerMask = Physics.AllLayers, queryTriggerInteraction: QueryTriggerInteraction = QueryTriggerInteraction.UseGlobal): Collider[] {
    return Physics.overlap(center, orientation, new RAPIER.Cuboid(halfExtents.x, halfExtents.y, halfExtents.z), layerMask, queryTriggerInteraction);
  }

  /** Whether any collider touches a sphere — Unity's `Physics.CheckSphere`: a ground check. */
  static checkSphere(position: Vector3, radius: number, layerMask = Physics.AllLayers, queryTriggerInteraction: QueryTriggerInteraction = QueryTriggerInteraction.UseGlobal): boolean {
    return Physics.overlap(position, IDENTITY, new RAPIER.Ball(radius), layerMask, queryTriggerInteraction, true).length > 0;
  }

  private static overlap(position: Vector3, rotation: RAPIER.Rotation, shape: RAPIER.Shape, mask: number, triggers: QueryTriggerInteraction, first = false): Collider[] {
    const physics = Physics.running();
    if (!physics) return [];
    const found: Collider[] = [];
    physics.world.intersectionsWithShape(position, rotation, shape, (created) => {
      const collider = physics.colliders.get(created.handle);
      if (collider) found.push(collider);
      return !first;
    }, filterFlags(triggers), undefined, undefined, undefined, physics.filter(mask));
    return found;
  }

  /** The running scene's physics, or null when nothing is running. */
  private static running(): Physics | null {
    const root = Runtime.current?.root;
    if (!root) return null;
    const physics = service(root, Physics);
    physics.refreshQueries();
    return physics;
  }

  /** Colliders came or went since the last step: queries would not see them yet. */
  private queriesStale = false;

  /**
   * Queries see bodies where the last step left them, and colliders made since — Rapier's queries
   * see only what a step has indexed, so a step of no time indexes them: nothing moves.
   */
  private refreshQueries(): void {
    if (!this.queriesStale) return;
    this.queriesStale = false;
    const timestep = this.world.timestep;
    this.world.timestep = 0;
    this.world.step(this.events); // what it finds starting is told with the next real step
    this.world.timestep = timestep;
  }

  /** @internal this scene's Rapier world. */
  world!: RAPIER.World;

  private events!: RAPIER.EventQueue;
  /** The `ignoreLayerCollision` this world's colliders were last given. */
  private layersApplied = layersChanged;
  private readonly bodies = new Set<Rigidbody>();
  /** Per dynamic body: its last two fixed poses, which `update` blends between. */
  private readonly poses = new Map<Rigidbody, Pose>();
  /** Rapier collider handle → collider, to turn a contact event back into objects. */
  private readonly colliders = new Map<number, Collider>();
  /** Handles removed since the last step: still named by that step's exit events. */
  private readonly retired: number[] = [];
  /** Colliders with no body: placed where their node is, and moved when it moves, as in Unity. */
  private readonly statics = new Set<Collider>();
  /** Colliders on a node under their body's: kept where that node is within the body. */
  private readonly mounted = new Set<Collider>();
  private readonly contacts: { a: Collider; b: Collider; started: boolean; impulse: Vector3 }[] = [];
  /** This step's contact forces by pair, as Rapier reports them: on its second collider, from its first. */
  private readonly forces = new Map<string, { first: number; force: Vector3 }>();
  /** Pairs touching now, by handle. A collider that goes away ends its pairs itself, at once. */
  private readonly touching = new Map<string, { a: Collider; b: Collider; ha: number; hb: number }>();

  override awake(): void {
    if (typeof RAPIER.World !== 'function') {
      throw new Error('Rapier is not loaded: `await initRapier()` before the scene renders — it is WebAssembly.');
    }
    this.world = new RAPIER.World(Physics.gravity);
    // Contacts within a centimetre, Unity's default contact offset (Rapier's is a fifth of that):
    // a body hopping over uneven ground keeps its grip, rather than meeting it afresh at each landing.
    this.world.integrationParameters.normalizedPredictionDistance = 0.01;
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
    const scale = node.getWorldScale(collider._builtScale);
    const surface = collider._surface();
    const desc = collider
      .shape(scale)
      .setFriction(surface.friction)
      .setRestitution(surface.bounciness)
      .setFrictionCombineRule(surface.frictionCombine as number as RAPIER.CoefficientCombineRule)
      .setRestitutionCombineRule(surface.bounceCombine as number as RAPIER.CoefficientCombineRule)
      .setDensity(collider.density)
      .setSensor(collider.isTrigger)
      .setCollisionGroups(collisionGroups(collider.layer))
      // Contact forces are how hard a hit was: a manifold's own impulses read zero against a triangle mesh.
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0)
      // Unity reports a trigger against anything with a body, kinematic included; Rapier's default does not.
      .setActiveCollisionTypes(collider.isTrigger ? RAPIER.ActiveCollisionTypes.ALL : RAPIER.ActiveCollisionTypes.DEFAULT);
    if (body) {
      const { p, q } = mountPose(collider, scale);
      desc.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      const owner = collider.attachedRigidbody?.node;
      if (owner && owner !== collider.node) this.mounted.add(collider);
    } else {
      const { p, q } = staticPose(collider);
      desc.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      this.statics.add(collider);
    }
    const created = this.world.createCollider(desc, body ?? undefined);
    this.colliders.set(created.handle, collider);
    this.queriesStale = true;
    return created;
  }

  /**
   * The shape at its node's new scale, on the same Rapier collider: made again, it would lose its
   * contacts each step, and a body growing on the ground sank through it. A box, sphere or capsule is
   * resized where it is; a mesh's shape is made again from its triangles.
   */
  private rescale(collider: Collider): void {
    const created = collider._collider!;
    const scale = collider.node.getWorldScale(collider._builtScale);
    if (!collider._resize(created, scale)) created.setShape(collider.shape(scale).shape);
    this.queriesStale = true;
    const body = created.parent();
    if (body) {
      const { p, q } = mountPose(collider, scale);
      created.setTranslationWrtParent(p);
      created.setRotationWrtParent(q);
      // Asleep, its contacts would not be looked for again: it would fall through what it rests on.
      body.wakeUp();
    } else {
      const { p, q } = staticPose(collider);
      created.setTranslation(p);
      created.setRotation(q);
    }
  }

  /** @internal */
  destroyCollider(created: RAPIER.Collider): void {
    const collider = this.colliders.get(created.handle);
    if (collider) {
      this.statics.delete(collider);
      this.mounted.delete(collider);
    }
    this.endContacts(created.handle);
    this.world.removeCollider(created, true);
    this.queriesStale = true;
  }

  private ground: RAPIER.RigidBody | null = null;

  /** @internal a fixed body at the world's origin: what a joint with no `connectedBody` holds on to. */
  _ground(): RAPIER.RigidBody {
    return (this.ground ??= this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
  }

  /** Only this package's enabled colliders, on the mask's layers: a query sees what the components made. */
  private filter(mask: number): (created: RAPIER.Collider) => boolean {
    return (created) => {
      const collider = this.colliders.get(created.handle);
      return !!collider && collider.enabled && ((mask >>> collider.layer) & 1) === 1;
    };
  }

  private hitOf(created: RAPIER.Collider, ray: RAPIER.Ray, distance: number, normal: RAPIER.Vector): RaycastHit | null {
    const collider = this.colliders.get(created.handle);
    if (!collider) return null;
    const point = new Vector3(ray.origin.x + ray.dir.x * distance, ray.origin.y + ray.dir.y * distance, ray.origin.z + ray.dir.z * distance);
    return { collider, rigidbody: collider.attachedRigidbody, node: collider.node, point, normal: new Vector3(normal.x, normal.y, normal.z), distance };
  }

  /**
   * The collider behind a Rapier collider or its handle — how a raycast, shape cast or contact
   * found through Rapier's API comes back to an object: `physics.colliderOf(hit.collider)?.node`.
   */
  colliderOf(collider: RAPIER.Collider | number): Collider | null {
    return this.colliders.get(typeof collider === 'number' ? collider : collider.handle) ?? null;
  }

  /**
   * `isKinematic` changed: Unity switches the body there and then. One let go starts still from where
   * its node was left, with no motion carried over from being moved.
   */
  private retype(rigidbody: Rigidbody, body: RAPIER.RigidBody): void {
    if (rigidbody.isKinematic) {
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      this.poses.delete(rigidbody);
      return;
    }
    const p = rigidbody.node.getWorldPosition(SCRATCH_V);
    const q = rigidbody.node.getWorldQuaternion(SCRATCH_Q);
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setTranslation(p, true);
    body.setRotation(q, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.poses.set(rigidbody, poseOf(body));
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
      if (body && rigidbody.isKinematic !== body.isKinematic()) this.retype(rigidbody, body);
      if (!rigidbody.isKinematic || !body || !rigidbody.enabled) continue;
      if (moving(body)) {
        drivenByBody.push(rigidbody);
        continue;
      }
      rigidbody.node.updateWorldMatrix(true, false);
      rigidbody.node.matrixWorld.decompose(SCRATCH_V, SCRATCH_Q, SCALE);
      body.setNextKinematicTranslation(SCRATCH_V);
      body.setNextKinematicRotation(SCRATCH_Q);
    }

    // Each collider's node brought up to date once, and read below from its world matrix as it is:
    // three's getWorldPosition, getWorldQuaternion and getWorldScale each walk up to the root again,
    // and a static collider was read five times a step — on a phone, a tenth of the frame.
    for (const collider of this.colliders.values()) {
      if (collider._collider && collider.enabled) collider.node.updateWorldMatrix(true, false);
    }

    // A static collider moved through its node — a scrolling obstacle, a sliding door — goes with it.
    for (const collider of this.statics) {
      const created = collider._collider;
      if (!created || !collider.enabled) continue;
      const { p, q } = staticPose(collider, true);
      const t = created.translation();
      const r = created.rotation();
      // Rapier keeps f32, so compare with a tolerance: an unmoved wall is not touched.
      if (Math.abs(t.x - p.x) + Math.abs(t.y - p.y) + Math.abs(t.z - p.z) > 1e-4) created.setTranslation(p);
      if (Math.abs(r.x - q.x) + Math.abs(r.y - q.y) + Math.abs(r.z - q.z) + Math.abs(r.w - q.w) > 1e-6) created.setRotation(q);
    }

    // A collider on a child of its body — a sword in a hand, a door on a car — goes where the child
    // is moved within the body.
    for (const collider of this.mounted) {
      const created = collider._collider;
      if (!created || !collider.enabled) continue;
      BEFORE_V.copy(collider._mount.p);
      BEFORE_Q.copy(collider._mount.q);
      const { p, q } = mountPose(collider, collider._builtScale, true);
      if (BEFORE_V.distanceToSquared(p) > 1e-8) created.setTranslationWrtParent(p);
      if (1 - Math.abs(BEFORE_Q.dot(q)) > 1e-7) created.setRotationWrtParent(q);
    }

    if (this.layersApplied !== layersChanged) {
      this.layersApplied = layersChanged;
      for (const collider of new Set(this.colliders.values())) collider._collider?.setCollisionGroups(collisionGroups(collider.layer));
    }

    // A node scaled since its shape was made — a pickup that grows — has it made again at the new
    // size, as Unity's colliders follow their transform's scale.
    const rescaled = new Set<Collider>();
    for (const collider of this.colliders.values()) {
      if (!collider._collider || !collider.enabled) continue;
      const scale = SCALE;
      collider.node.matrixWorld.decompose(SCRATCH_V, SCRATCH_Q, scale);
      if (Math.abs(scale.x - collider._builtScale.x) + Math.abs(scale.y - collider._builtScale.y) + Math.abs(scale.z - collider._builtScale.z) > 1e-5) rescaled.add(collider);
    }
    for (const collider of rescaled) this.rescale(collider);

    // Unity's cap holds inside the step, as PhysX's solver applies it: a torque this frame may not
    // spin a body past it even for one step — the contacts would slip at the higher speed.
    for (const rigidbody of this.poses.keys()) if (rigidbody._body) capSpin(rigidbody._body, rigidbody.maxAngularVelocity);

    this.world.gravity = Physics.gravity;
    this.world.timestep = dt;
    this.world.step(this.events);
    this.queriesStale = false;

    this.forces.clear();
    this.events.drainContactForceEvents((event) => {
      const force = event.totalForce();
      if (!Number.isFinite(force.x + force.y + force.z)) return; // from a query's step of no time
      this.forces.set(pairKey(event.collider1(), event.collider2()), { first: event.collider1(), force: new Vector3(force.x, force.y, force.z).multiplyScalar(dt) });
    });
    const began = new Set<string>();
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (this.retired.includes(h1) || this.retired.includes(h2)) return; // already ended by endContacts
      const a = this.colliders.get(h1);
      const b = this.colliders.get(h2);
      if (!a || !b) return this.reportForeign(a ? h2 : h1);
      const key = pairKey(h1, h2);
      if (started) {
        this.touching.set(key, { a, b, ha: h1, hb: h2 });
        began.add(key);
      }
      else if (!this.touching.delete(key)) return;
      this.contacts.push({ a, b, started, impulse: started ? this.impulseBetween(h1, h2) : new Vector3() });
    });
    for (const handle of this.retired) this.colliders.delete(handle);
    this.retired.length = 0;

    for (const [rigidbody, pose] of this.poses) {
      const body = rigidbody._body;
      if (!body) continue;
      capSpin(body, rigidbody.maxAngularVelocity);
      advance(pose, body, dt);
    }
    for (const rigidbody of drivenByBody) {
      const t = rigidbody._body!.translation();
      const r = rigidbody._body!.rotation();
      applyWorldPose(rigidbody.node, BLEND_V.set(t.x, t.y, t.z), BLEND_Q.set(r.x, r.y, r.z, r.w));
    }

    // Unity's Stay, every step after the one that began, for pairs that are not both asleep.
    const stays: { a: Collider; b: Collider; impulse: Vector3 }[] = [];
    for (const [key, { a, b, ha, hb }] of this.touching) {
      if (began.has(key) || (asleep(a) && asleep(b))) continue;
      stays.push({ a, b, impulse: this.impulseBetween(ha, hb) });
    }

    for (const { a, b, started, impulse } of this.contacts.splice(0)) this.dispatch(a, b, started ? 'Enter' : 'Exit', impulse);
    for (const { a, b, impulse } of stays) this.dispatch(a, b, 'Stay', impulse);
  }

  /** The impulse between two colliders this step: on the first, from the second. */
  private impulseBetween(h1: number, h2: number): Vector3 {
    const found = this.forces.get(pairKey(h1, h2));
    if (!found) return new Vector3();
    return found.first === h1 ? found.force.clone().negate() : found.force.clone();
  }

  /**
   * Both sides hear it, each about the other — Unity's messages, Unity's payloads. A collider on a
   * child of its body is heard on its own node and on the body's, as in Unity.
   */
  private dispatch(a: Collider, b: Collider, phase: 'Enter' | 'Stay' | 'Exit', impulse: Vector3): void {
    if (a.isTrigger || b.isTrigger) {
      tell(a, `onTrigger${phase}`, b);
      tell(b, `onTrigger${phase}`, a);
    } else {
      const world = phase === 'Exit' ? null : this.world;
      tell(a, `onCollision${phase}`, new Collision(b, impulse, a, world));
      tell(b, `onCollision${phase}`, new Collision(a, impulse.clone().negate(), b, world));
    }
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
      this.dispatch(pair.a, pair.b, 'Exit', new Vector3());
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

/** Per layer, the layers it passes through, one bit each. Shared by every scene, as Unity's matrix is. */
const ignoredLayers = new Uint16Array(16);
let layersChanged = 0;

/** @internal a layer, refused when Rapier's collision groups cannot hold it. */
export function checkLayer(layer: number): void {
  if (!Number.isInteger(layer) || layer < 0 || layer > 15) throw new Error(`Physics layers are 0 to 15 (Rapier's collision groups), not ${layer}.`);
}

/** @internal Rapier's groups for a layer: what it is a member of, and what it meets. */
export function collisionGroups(layer: number): number {
  return ((1 << layer) << 16) | (0xffff & ~ignoredLayers[layer]!);
}

/**
 * Where a static collider's shape sits in the world: its node's pose, offset by `center`. `fresh`
 * when the node's world matrix is already up to date this step.
 */
function staticPose(collider: Collider, fresh = false): { p: Vector3; q: Quaternion } {
  if (!fresh) collider.node.updateWorldMatrix(true, false);
  collider.node.matrixWorld.decompose(SCRATCH_V, STATIC_Q, STATIC_S);
  const p = STATIC_V.copy(collider.center).multiply(STATIC_S).applyQuaternion(STATIC_Q).add(SCRATCH_V);
  return { p, q: STATIC_Q };
}

/**
 * Where a body's collider sits within the body: its node's pose relative to the body's node, offset
 * by `center` — the same as the node's own for a collider on the body's node.
 */
function mountPose(collider: Collider, scale: Vector3, fresh = false): { p: Vector3; q: Quaternion } {
  const { p, q } = collider._mount;
  const owner = collider.attachedRigidbody?.node;
  if (!owner || owner === collider.node) {
    p.copy(collider.center).multiply(scale);
    q.identity();
    return collider._mount;
  }
  // The owner is the node's ancestor: one walk up from the node brings both up to date.
  if (!fresh) collider.node.updateWorldMatrix(true, false);
  owner.matrixWorld.decompose(SCRATCH_V, MOUNT_Q, STATIC_S);
  collider.node.matrixWorld.decompose(MOUNT_V, SCALE_Q, STATIC_S);
  const inverse = MOUNT_Q.invert();
  q.copy(SCALE_Q).premultiply(inverse);
  p.copy(collider.center).multiply(scale).applyQuaternion(SCALE_Q);
  p.add(MOUNT_V).sub(SCRATCH_V).applyQuaternion(inverse);
  return collider._mount;
}

/** Unity's `maxAngularVelocity`: a body spinning faster is slowed to it, its axis kept. */
function capSpin(body: RAPIER.RigidBody, max: number): void {
  const w = body.angvel();
  const speed = Math.hypot(w.x, w.y, w.z);
  if (speed > max) body.setAngvel({ x: (w.x / speed) * max, y: (w.y / speed) * max, z: (w.z / speed) * max }, true);
}

function moving(body: RAPIER.RigidBody): boolean {
  const t = body.translation();
  const n = body.nextTranslation();
  const r = body.rotation();
  const m = body.nextRotation();
  return t.x !== n.x || t.y !== n.y || t.z !== n.z || r.x !== m.x || r.y !== m.y || r.z !== m.z || r.w !== m.w;
}

function tell(collider: Collider, name: string, payload: unknown): void {
  sendMessage(collider.node, name, payload);
  const owner = collider.attachedRigidbody?.node;
  if (owner && owner !== collider.node) sendMessage(owner, name, payload);
}

function pairKey(h1: number, h2: number): string {
  return h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
}

/** A collider whose body sleeps, or a static one: Unity sends no Stay between two of these. */
function asleep(collider: Collider): boolean {
  const body = collider._collider?.parent();
  return !body || body.isSleeping() || body.isFixed();
}

/** The points where two colliders touch now, as `self` sees them. */
function contactsBetween(world: RAPIER.World, self: Collider, other: Collider): ContactPoint[] {
  const a = self._collider;
  const b = other._collider;
  if (!a || !b || !world.getCollider(a.handle) || !world.getCollider(b.handle)) return [];
  const found: ContactPoint[] = [];
  world.contactPair(a, b, (manifold, flipped) => {
    // The manifold is from its first collider to its second; `flipped` says the first is `b`.
    const first = flipped ? b : a;
    const n = manifold.normal();
    const toSelf = flipped ? new Vector3(n.x, n.y, n.z) : new Vector3(-n.x, -n.y, -n.z);
    const t = first.translation();
    const r = first.rotation();
    const rotation = new Quaternion(r.x, r.y, r.z, r.w);
    for (let i = 0; i < manifold.numContacts(); i++) {
      const local = manifold.localContactPoint1(i);
      if (!local) continue;
      const point = new Vector3(local.x, local.y, local.z).applyQuaternion(rotation).add(new Vector3(t.x, t.y, t.z));
      found.push({ point, normal: toSelf.clone(), separation: manifold.contactDist(i), thisCollider: self, otherCollider: other });
    }
  });
  return found;
}

type RayArgs = [Vector3, Vector3, number?, number?, QueryTriggerInteraction?] | [Ray, number?, number?, QueryTriggerInteraction?];

/** A query's ray, unit long, and how far it goes: three's `Ray`, or an origin and a direction. */
function rayOf(args: RayArgs): { ray: RAPIER.Ray; length: number; mask: number; triggers: QueryTriggerInteraction } {
  const [first, ...rest] = args;
  // three's Ray, or one from another copy of three.
  const isRay = first instanceof Ray || 'direction' in first;
  const origin = isRay ? (first as Ray).origin : (first as Vector3);
  const direction = QUERY_V.copy(isRay ? (first as Ray).direction : (rest.shift() as Vector3)).normalize();
  const [maxDistance = Infinity, mask = Physics.AllLayers, triggers = QueryTriggerInteraction.UseGlobal] = rest as [number?, number?, QueryTriggerInteraction?];
  return { ray: new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: direction.x, y: direction.y, z: direction.z }), length: finite(maxDistance), mask, triggers };
}

function filterFlags(triggers: QueryTriggerInteraction): RAPIER.QueryFilterFlags | undefined {
  const hit = triggers === QueryTriggerInteraction.UseGlobal ? Physics.queriesHitTriggers : triggers === QueryTriggerInteraction.Collide;
  return hit ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
}

/** Rapier's casts want a finite length: Unity's `Mathf.Infinity` becomes a very long one. */
function finite(distance: number): number {
  return Number.isFinite(distance) ? distance : 1e7;
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
const STATIC_S = new Vector3();
const QUERY_V = new Vector3();
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const SCALE_Q = new Quaternion();
const MOUNT_V = new Vector3();
const MOUNT_Q = new Quaternion();
const BEFORE_V = new Vector3();
const BEFORE_Q = new Quaternion();
