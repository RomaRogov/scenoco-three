import { AABB, CircleShape, PolygonShape, Transform, Vec2, World, testOverlap, type Body, type Contact, type Fixture, type Shape } from 'planck';
import { MathUtils, Vector2, type Object3D } from 'three';
import { Runtime, System, destroy, sendMessage, service } from '@scenoco-three/core';
import { Collision2D, type ContactPoint2D, type RaycastHit2D } from './Collision2D.js';
import type { Collider2D } from './Collider2D.js';
import type { Joint2D } from './joints.js';
import { RigidbodyConstraints2D, RigidbodyType2D, type Rigidbody2D } from './Rigidbody2D.js';
import { applyWorldPose, sameFrame, shapeFrame, worldPose } from './transform.js';

/**
 * The 2D physics world, on planck (a pure-JS Box2D) — Unity's `Physics2D`. Made by the first body
 * or collider that wakes; nothing has to declare it. `Physics2D.gravity.set(0, 0)` for none, and
 * `Physics2D.world` is planck's own world for anything the components do not expose.
 *
 * Each `fixedUpdate`, after every behaviour's: kinematic bodies go where they were moved, colliders
 * follow their nodes, the world steps, dynamic bodies write back, and only then are contacts sent —
 * so a handler may destroy freely.
 */
export class Physics2D extends System {
  /** Gravity, in metres per second squared — Unity's `Physics2D.gravity`. Read every step. */
  static readonly gravity = new Vector2(0, -9.81);
  /** Velocity solver iterations per step — Unity's default, 8. */
  static velocityIterations = 8;
  /** Position solver iterations per step — Unity's default, 3. */
  static positionIterations = 3;
  /** Whether queries hit triggers when they do not say — Unity's `Physics2D.queriesHitTriggers`. */
  static queriesHitTriggers = true;
  /** Whether a ray that starts inside a collider hits it, at its start — Unity's `Physics2D.queriesStartInColliders`. */
  static queriesStartInColliders = true;
  /** Every layer, for a query's `layerMask` — Unity's `Physics2D.AllLayers`. One layer is `1 << layer`. */
  static readonly AllLayers = 0xffff;

  /**
   * Whether colliders on these two layers pass through each other — Unity's
   * `Physics2D.IgnoreLayerCollision`: no contact, no trigger, no messages. Layers are 0 to 15, Box2D's
   * collision bits. Colliders already made take it at once.
   */
  static ignoreLayerCollision(layer1: number, layer2: number, ignore = true): void {
    for (const [a, b] of [[layer1, layer2], [layer2, layer1]] as const) {
      checkLayer(a);
      if (ignore) ignoredLayers[a]! |= 1 << b;
      else ignoredLayers[a]! &= ~(1 << b);
    }
    for (const physics of worlds) for (const collider of physics.colliders) collider.layer = collider.layer;
  }

  /** Whether `ignoreLayerCollision` has these two layers pass through each other. */
  static getIgnoreLayerCollision(layer1: number, layer2: number): boolean {
    checkLayer(layer1);
    checkLayer(layer2);
    return (ignoredLayers[layer1]! & (1 << layer2)) !== 0;
  }

  /** The running scene's planck world — planck's own API, for anything these do not cover. */
  static get world(): World | null {
    return Physics2D.running()?.world ?? null;
  }

  /**
   * The first collider a ray from `origin` along `direction` meets — Unity's `Physics2D.Raycast`,
   * returning the hit or null. With `queriesStartInColliders`, one the ray starts inside is hit at
   * once, as in Unity: start the ray outside your own collider, or give it another layer.
   */
  static raycast(origin: Vector2, direction: Vector2, distance = Infinity, layerMask = Physics2D.AllLayers): RaycastHit2D | null {
    return Physics2D.running()?.cast(origin, direction, distance, layerMask, false)[0] ?? null;
  }

  /** Every collider the ray meets, nearest first — Unity's `Physics2D.RaycastAll`. */
  static raycastAll(origin: Vector2, direction: Vector2, distance = Infinity, layerMask = Physics2D.AllLayers): RaycastHit2D[] {
    return Physics2D.running()?.cast(origin, direction, distance, layerMask, true) ?? [];
  }

  /** A collider the point is inside — Unity's `Physics2D.OverlapPoint`. */
  static overlapPoint(point: Vector2, layerMask = Physics2D.AllLayers): Collider2D | null {
    return Physics2D.running()?.overlap(new CircleShape(new Vec2(point.x, point.y), 1e-4), layerMask, true)[0] ?? null;
  }

  /** A collider touching the circle — Unity's `Physics2D.OverlapCircle`. */
  static overlapCircle(point: Vector2, radius: number, layerMask = Physics2D.AllLayers): Collider2D | null {
    return Physics2D.running()?.overlap(new CircleShape(new Vec2(point.x, point.y), radius), layerMask, true)[0] ?? null;
  }

  /** Every collider touching the circle — Unity's `Physics2D.OverlapCircleAll`. */
  static overlapCircleAll(point: Vector2, radius: number, layerMask = Physics2D.AllLayers): Collider2D[] {
    return Physics2D.running()?.overlap(new CircleShape(new Vec2(point.x, point.y), radius), layerMask, false) ?? [];
  }

  /** A collider touching the box `size` wide and high, turned by `angle` degrees — Unity's `Physics2D.OverlapBox`. */
  static overlapBox(point: Vector2, size: Vector2, angle = 0, layerMask = Physics2D.AllLayers): Collider2D | null {
    return Physics2D.running()?.overlap(box(point, size, angle), layerMask, true)[0] ?? null;
  }

  /** Every collider touching the box — Unity's `Physics2D.OverlapBoxAll`. */
  static overlapBoxAll(point: Vector2, size: Vector2, angle = 0, layerMask = Physics2D.AllLayers): Collider2D[] {
    return Physics2D.running()?.overlap(box(point, size, angle), layerMask, false) ?? [];
  }

  /** The running scene's physics, or null when nothing is running. */
  private static running(): Physics2D | null {
    const root = Runtime.current?.root;
    return root ? service(root, Physics2D) : null;
  }

  /** planck's world, for its own API. */
  world!: World;

  private readonly bodies = new Set<Rigidbody2D>();
  /** @internal every collider with fixtures, so a layer change or a moved node reaches each. */
  readonly colliders = new Set<Collider2D>();
  /** Per dynamic body: its last two fixed poses, which `update` blends between. */
  private readonly poses = new Map<Rigidbody2D, Pose>();
  /** Collider pairs touching now, and through how many of their fixtures. */
  private readonly touching = new Map<string, Touch>();
  /** Enters and exits raised during the step, sent after it. */
  private readonly events: { touch: Touch; phase: 'Enter' | 'Exit' }[] = [];
  /** This step's normal impulses, by contact. */
  private readonly impulses = new Map<Contact, number[]>();
  /** @internal every made joint, set before each step and measured after. */
  readonly joints = new Set<Joint2D>();
  /** The world's own body, for joints with no connected body. */
  private ground: Body | null = null;

  override awake(): void {
    this.world = new World({ gravity: new Vec2(Physics2D.gravity.x, Physics2D.gravity.y) });
    this.world.on('begin-contact', (contact) => this.touch(contact, 1));
    this.world.on('end-contact', (contact) => this.touch(contact, -1));
    this.world.on('post-solve', (contact, impulse) => this.impulses.set(contact, [...impulse.normalImpulses]));
    // A body destroyed takes its joints with it.
    this.world.on('remove-joint', (joint) => (joint.getUserData() as Joint2D | null)?._lost(joint));
    worlds.add(this);
  }

  override onDestroy(): void {
    worlds.delete(this);
    for (const rigidbody of this.bodies) rigidbody._body = null;
    for (const collider of this.colliders) {
      collider._body = null;
      collider._fixtures = [];
    }
    for (const joint of this.joints) joint._lost(joint.planckJoint!);
    this.bodies.clear();
    this.colliders.clear();
    this.poses.clear();
    this.touching.clear();
  }

  // --- membership: bodies and colliders join in their hooks, nothing is rediscovered -------

  /** @internal */
  createBody(rigidbody: Rigidbody2D): Body {
    const { x, y, angle } = worldPose(rigidbody.node);
    const body = this.world.createBody({
      type: BODY_TYPES[rigidbody.bodyType],
      position: new Vec2(x, y),
      angle,
      linearDamping: rigidbody.linearDamping,
      angularDamping: rigidbody.angularDamping,
      gravityScale: rigidbody.gravityScale,
      bullet: rigidbody.collisionDetectionMode === 1,
    });
    body.setUserData(rigidbody);
    this.bodies.add(rigidbody);
    this.poses.set(rigidbody, poseOf(body));
    return body;
  }

  /** @internal */
  destroyBody(rigidbody: Rigidbody2D): void {
    const body = rigidbody._body;
    if (body) {
      for (const collider of this.collidersOn(body)) this.destroyFixtures(collider);
      this.world.destroyBody(body);
    }
    this.bodies.delete(rigidbody);
    this.poses.delete(rigidbody);
  }

  /** @internal a static body of its own, where its node is, for a collider with no Rigidbody2D. */
  createStaticBody(collider: Collider2D): Body {
    const { x, y, angle } = worldPose(collider.node);
    const body = this.world.createBody({ type: 'static', position: new Vec2(x, y), angle });
    body.setUserData(null);
    return body;
  }

  /** @internal */
  destroyStaticBody(collider: Collider2D): void {
    if (collider._body) this.world.destroyBody(collider._body);
  }

  /** @internal the collider's shape onto `body`, placed where its node is in the body's. */
  createFixtures(collider: Collider2D, body: Body): void {
    const owner = collider._ownBody || body.getUserData() === null ? collider.node : (body.getUserData() as Rigidbody2D).node;
    const frame = shapeFrame(collider.node, owner);
    collider._body = body;
    collider._frame = frame;
    collider._fixtures = collider.shapes(frame).map((shape) =>
      body.createFixture({
        shape,
        density: collider.density,
        friction: collider.friction,
        restitution: collider.bounciness,
        isSensor: collider.isTrigger,
        userData: collider,
        ...layerFilter(collider.layer),
      }),
    );
    this.colliders.add(collider);
  }

  /** @internal its fixtures off its body; what they touched hears it leave. */
  destroyFixtures(collider: Collider2D): void {
    for (const fixture of collider._fixtures) collider._body?.destroyFixture(fixture);
    collider._fixtures = [];
    this.colliders.delete(collider);
  }

  /** @internal a static body at the origin, holding the world's side of a joint with no connected body. */
  _ground(): Body {
    return (this.ground ??= this.world.createBody({ type: 'static' }));
  }

  /** @internal the colliders shaping a body. */
  collidersOn(body: Body): Set<Collider2D> {
    const found = new Set<Collider2D>();
    for (let f = body.getFixtureList(); f; f = f.getNext()) found.add(f.getUserData() as Collider2D);
    return found;
  }

  /** @internal drop the interpolation history, so a teleport does not blend across the jump. */
  resetInterpolation(rigidbody: Rigidbody2D): void {
    if (rigidbody._body && this.poses.has(rigidbody)) this.poses.set(rigidbody, poseOf(rigidbody._body));
  }

  // --- the step ------------------------------------------------------------------------------

  override fixedUpdate(dt: number): void {
    // What each body is asked to be: a kinematic one where its node was moved, or where
    // `movePosition` said — reached as a velocity over the step, so it pushes what is in the way.
    const restore: [Rigidbody2D, Vec2, number, boolean][] = [];
    for (const rigidbody of this.bodies) {
      const body = rigidbody._body;
      if (!body || !rigidbody.isActiveAndEnabled) continue;
      const kinematic = rigidbody.bodyType === RigidbodyType2D.Kinematic;
      const node = worldPose(rigidbody.node);
      const pose = this.poses.get(rigidbody)!;
      // A static or kinematic body whose node something moved — the game, an editor — goes there.
      const moved = rigidbody.bodyType !== RigidbodyType2D.Dynamic && (Math.abs(node.x - pose.x) + Math.abs(node.y - pose.y) > 1e-6 || Math.abs(node.angle - pose.angle) > 1e-6);
      if (rigidbody.bodyType === RigidbodyType2D.Static && moved) body.setTransform(new Vec2(node.x, node.y), node.angle);
      const asked = rigidbody._target;
      const target = asked ?? (kinematic && moved ? node : null);
      rigidbody._target = null;
      if (!target) continue;
      const p = body.getPosition();
      restore.push([rigidbody, body.getLinearVelocity().clone(), body.getAngularVelocity(), asked !== null]);
      body.setLinearVelocity(new Vec2((target.x - p.x) / dt, (target.y - p.y) / dt));
      body.setAngularVelocity(Math.atan2(Math.sin(target.angle - body.getAngle()), Math.cos(target.angle - body.getAngle())) / dt);
      body.setAwake(true);
    }

    // A frozen axis holds still: no speed along it into the step, and its place back after.
    const frozen: [Body, number, number, number][] = [];
    for (const rigidbody of this.bodies) {
      const body = rigidbody._body;
      if (!body || rigidbody.bodyType !== RigidbodyType2D.Dynamic) continue;
      const x = rigidbody.frozen(RigidbodyConstraints2D.FreezePositionX);
      const y = rigidbody.frozen(RigidbodyConstraints2D.FreezePositionY);
      if (!x && !y) continue;
      const v = body.getLinearVelocity();
      body.setLinearVelocity(new Vec2(x ? 0 : v.x, y ? 0 : v.y));
      const p = body.getPosition();
      frozen.push([body, x ? p.x : Number.NaN, y ? p.y : Number.NaN, 0]);
    }

    // A collider moved or scaled through its node goes with it: a static one's own body is moved,
    // one on a child node of its body is placed again within it.
    for (const collider of [...this.colliders]) {
      if (!collider._body || !collider._frame) continue;
      if (collider._ownBody) {
        const { x, y, angle } = worldPose(collider.node);
        const at = collider._body.getPosition();
        if (Math.abs(at.x - x) + Math.abs(at.y - y) > 1e-6 || Math.abs(collider._body.getAngle() - angle) > 1e-6) collider._body.setTransform(new Vec2(x, y), angle);
      }
      const owner = collider._ownBody ? collider.node : (collider._body.getUserData() as Rigidbody2D).node;
      if (!sameFrame(collider._frame, shapeFrame(collider.node, owner))) collider._rebuild();
    }

    for (const joint of [...this.joints]) joint._sync();

    this.world.setGravity(new Vec2(Physics2D.gravity.x, Physics2D.gravity.y));
    this.impulses.clear();
    this.world.step(dt, Physics2D.velocityIterations, Physics2D.positionIterations);
    const broken = [...this.joints].filter((joint) => joint._measure(1 / dt));

    for (const [body, x, y] of frozen) {
      const p = body.getPosition();
      if (!Number.isNaN(x) || !Number.isNaN(y)) body.setPosition(new Vec2(Number.isNaN(x) ? p.x : x, Number.isNaN(y) ? p.y : y));
    }
    for (const [rigidbody, velocity, spin, asked] of restore) {
      const body = rigidbody._body!;
      // Moved by `movePosition`, not by its node: the node follows it there.
      if (asked && rigidbody.bodyType !== RigidbodyType2D.Dynamic) {
        const p = body.getPosition();
        applyWorldPose(rigidbody.node, p.x, p.y, body.getAngle());
      }
      // A kinematic body moved for one step only; a dynamic one keeps the motion it had.
      if (rigidbody.bodyType === RigidbodyType2D.Kinematic) {
        body.setLinearVelocity(new Vec2());
        body.setAngularVelocity(0);
      } else {
        body.setLinearVelocity(velocity);
        body.setAngularVelocity(spin);
      }
    }
    for (const [rigidbody, pose] of this.poses) if (rigidbody._body && rigidbody.isActiveAndEnabled) advance(pose, rigidbody._body, dt);

    this.dispatchContacts();
    // As in Unity, a broken joint tells its node, then is destroyed.
    for (const joint of broken) {
      sendMessage(joint.node, 'onJointBreak2D', joint);
      destroy(joint);
    }
  }

  /** Dynamic bodies are drawn between their last two fixed poses, so motion is smooth at any frame rate. */
  override update(): void {
    const t = Math.min(this.runtime.interpolationAlpha, 1);
    for (const [rigidbody, pose] of this.poses) {
      if (!rigidbody.isActiveAndEnabled || rigidbody.bodyType !== RigidbodyType2D.Dynamic) continue;
      applyWorldPose(rigidbody.node, pose.previousX + (pose.x - pose.previousX) * t, pose.previousY + (pose.y - pose.previousY) * t, lerpAngle(pose.previousAngle, pose.angle, t));
    }
  }

  // --- contacts ------------------------------------------------------------------------------

  /**
   * A fixture pair began or stopped touching. A collider of several fixtures — a concave polygon —
   * touches another once, so pairs are counted, and Enter and Exit come at the first and the last.
   */
  private touch(contact: Contact, delta: 1 | -1): void {
    const a = contact.getFixtureA().getUserData() as Collider2D | undefined;
    const b = contact.getFixtureB().getUserData() as Collider2D | undefined;
    if (!a || !b || a === b) return;
    const key = pairKey(a, b);
    let touch = this.touching.get(key);
    if (!touch) {
      if (delta < 0) return;
      // The nodes now: a handler may destroy one before the messages go out.
      touch = { a: side(a), b: side(b), count: 0, began: true, velocity: relativeVelocity(a, b) };
      this.touching.set(key, touch);
    }
    touch.count += delta;
    if (delta > 0 && touch.count === 1) this.events.push({ touch, phase: 'Enter' });
    if (touch.count <= 0) {
      this.touching.delete(key);
      this.events.push({ touch, phase: 'Exit' });
    }
  }

  private dispatchContacts(): void {
    const events = this.events.splice(0);
    const stays: Touch[] = [];
    for (const touch of this.touching.values()) {
      if (touch.began) {
        touch.began = false;
        continue;
      }
      // Unity sends no Stay between two bodies that sleep, or a sleeping one and a static collider.
      if (asleep(touch.a.collider) && asleep(touch.b.collider)) continue;
      stays.push(touch);
    }
    for (const { touch, phase } of events) this.tell(touch, phase);
    for (const touch of stays) this.tell(touch, 'Stay');
  }

  /** Both sides hear it, each about the other — on the collider's node and its body's, as in Unity. */
  private tell(touch: Touch, phase: 'Enter' | 'Stay' | 'Exit'): void {
    const { a, b } = touch;
    if (a.collider.isTrigger || b.collider.isTrigger) {
      send(a, `onTrigger${phase}2D`, b.collider);
      send(b, `onTrigger${phase}2D`, a.collider);
      return;
    }
    const found = phase === 'Exit' ? () => [] : (self: Collider2D, other: Collider2D) => this.contactsBetween(self, other);
    const velocity = phase === 'Exit' ? new Vector2() : phase === 'Enter' ? touch.velocity : relativeVelocity(a.collider, b.collider);
    send(a, `onCollision${phase}2D`, new Collision2D(a, b, velocity, found));
    send(b, `onCollision${phase}2D`, new Collision2D(b, a, velocity.clone().negate(), found));
  }

  /** The points where two colliders touch now, as `self` sees them. */
  private contactsBetween(self: Collider2D, other: Collider2D): ContactPoint2D[] {
    const body = self._body;
    if (!body) return [];
    const found: ContactPoint2D[] = [];
    for (let edge = body.getContactList(); edge; edge = edge.next ?? null) {
      const contact = edge.contact;
      if (!contact.isTouching()) continue;
      const fa = contact.getFixtureA().getUserData();
      const fb = contact.getFixtureB().getUserData();
      const flipped = fa === other && fb === self;
      if (!flipped && !(fa === self && fb === other)) continue;
      const manifold = contact.getWorldManifold(null);
      if (!manifold) continue;
      // The manifold's normal points from A to B: towards `self` it is B→A, unless `self` is B.
      const sign = flipped ? 1 : -1;
      const impulses = this.impulses.get(contact) ?? [];
      for (let i = 0; i < contact.getManifold().pointCount; i++) {
        const point = manifold.points[i]!;
        found.push({
          point: new Vector2(point.x, point.y),
          normal: new Vector2(manifold.normal.x * sign, manifold.normal.y * sign),
          separation: manifold.separations[i] ?? 0,
          normalImpulse: impulses[i] ?? 0,
          collider: self,
          otherCollider: other,
        });
      }
    }
    return found;
  }

  // --- queries -------------------------------------------------------------------------------

  /** Only this package's enabled colliders, on the mask's layers, and triggers as `queriesHitTriggers` says. */
  private accepts(fixture: Fixture, mask: number): Collider2D | null {
    const collider = fixture.getUserData() as Collider2D | undefined;
    if (!collider || !collider.enabled || ((mask >>> collider.layer) & 1) !== 1) return null;
    if (collider.isTrigger && !Physics2D.queriesHitTriggers) return null;
    return collider;
  }

  private cast(origin: Vector2, direction: Vector2, distance: number, mask: number, all: boolean): RaycastHit2D[] {
    const dir = direction.clone().normalize();
    const length = Number.isFinite(distance) ? distance : 1e6;
    const start = new Vec2(origin.x, origin.y);
    const end = new Vec2(origin.x + dir.x * length, origin.y + dir.y * length);
    const hits: RaycastHit2D[] = [];
    const seen = new Set<Collider2D>();
    if (Physics2D.queriesStartInColliders) {
      this.world.queryAABB(new AABB(start, start), (fixture) => {
        const collider = this.accepts(fixture, mask);
        if (collider && !seen.has(collider) && fixture.testPoint(start)) {
          seen.add(collider);
          hits.push(hitOf(collider, origin.clone(), dir.clone().negate(), 0, 0));
        }
        return true;
      });
      if (hits.length && !all) return hits.slice(0, 1);
    }
    this.world.rayCast(start, end, (fixture, point, normal, fraction) => {
      const collider = this.accepts(fixture, mask);
      if (!collider) return -1;
      const hit = hitOf(collider, new Vector2(point.x, point.y), new Vector2(normal.x, normal.y), fraction * length, fraction);
      if (all) {
        // A collider of several fixtures is hit once: where the ray first meets it.
        const was = hits.findIndex((h) => h.collider === collider);
        if (was === -1) hits.push(hit);
        else if (hits[was]!.distance > hit.distance) hits[was] = hit;
        return 1;
      }
      hits[0] = hit;
      return fraction;
    });
    return hits.sort((a, b) => a.distance - b.distance);
  }

  private overlap(shape: Shape, mask: number, first: boolean): Collider2D[] {
    const xf = Transform.identity();
    const bounds = new AABB();
    shape.computeAABB(bounds, xf, 0);
    const found: Collider2D[] = [];
    this.world.queryAABB(bounds, (fixture) => {
      const collider = this.accepts(fixture, mask);
      if (!collider || found.includes(collider)) return true;
      const theirs = fixture.getShape();
      const at = fixture.getBody().getTransform();
      for (let child = 0; child < theirs.getChildCount(); child++) {
        if (testOverlap(shape, 0, theirs, child, xf, at)) {
          found.push(collider);
          return !first;
        }
      }
      return true;
    });
    return found;
  }
}

/** Every running world, so a layer change reaches each. */
const worlds = new Set<Physics2D>();

/** Per layer, the layers it passes through, one bit each. Shared by every scene, as Unity's matrix is. */
const ignoredLayers = new Uint16Array(16);

/** @internal a layer, refused when Box2D's collision bits cannot hold it. */
export function checkLayer(layer: number): void {
  if (!Number.isInteger(layer) || layer < 0 || layer > 15) throw new Error(`Physics layers are 0 to 15 (Box2D's collision bits), not ${layer}.`);
}

/** @internal Box2D's filter for a layer: what it is, and what it meets. */
export function layerFilter(layer: number): { filterCategoryBits: number; filterMaskBits: number; filterGroupIndex: number } {
  return { filterCategoryBits: 1 << layer, filterMaskBits: 0xffff & ~ignoredLayers[layer]!, filterGroupIndex: 0 };
}

const BODY_TYPES = ['dynamic', 'kinematic', 'static'] as const;

/**
 * One side of a contact, as it was when they met: a handler may destroy either before the messages
 * go out, and they still go — Unity sends the Exit of a destroyed collider too.
 */
interface Side {
  collider: Collider2D;
  node: Object3D;
  rigidbody: Rigidbody2D | null;
}

function side(collider: Collider2D): Side {
  return { collider, node: collider.node, rigidbody: collider.attachedRigidbody };
}

interface Touch {
  a: Side;
  b: Side;
  /** Fixture pairs touching: a collider may be several fixtures. */
  count: number;
  /** Entered this step: its Stay starts with the next. */
  began: boolean;
  /** `b`'s velocity minus `a`'s, when they met. */
  velocity: Vector2;
}

function pairKey(a: Collider2D, b: Collider2D): string {
  const ia = idOf(a);
  const ib = idOf(b);
  return ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
}

const ids = new WeakMap<Collider2D, number>();
let nextId = 0;
function idOf(collider: Collider2D): number {
  let id = ids.get(collider);
  if (id === undefined) ids.set(collider, (id = nextId++));
  return id;
}

/** Tell a collider's node, and its body's node when that is another. */
function send({ node, rigidbody }: Side, message: string, payload: unknown): void {
  sendMessage(node, message, payload);
  const owner = rigidbody?._node;
  if (owner && owner !== node) sendMessage(owner, message, payload);
}

/** A collider whose body sleeps, or a static one. */
function asleep(collider: Collider2D): boolean {
  const body = collider._body;
  return !body || !body.isAwake() || body.isStatic();
}

/** `b`'s velocity minus `a`'s, at their centres. */
function relativeVelocity(a: Collider2D, b: Collider2D): Vector2 {
  const va = a._body?.getLinearVelocity() ?? { x: 0, y: 0 };
  const vb = b._body?.getLinearVelocity() ?? { x: 0, y: 0 };
  return new Vector2(vb.x - va.x, vb.y - va.y);
}

function hitOf(collider: Collider2D, point: Vector2, normal: Vector2, distance: number, fraction: number): RaycastHit2D {
  return { collider, rigidbody: collider.attachedRigidbody, node: collider.node, point, normal, distance, fraction };
}

function box(point: Vector2, size: Vector2, angle: number): PolygonShape {
  const half = [size.x / 2, size.y / 2];
  const turn = MathUtils.degToRad(angle);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return new PolygonShape(
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const x = sx! * half[0]!;
      const y = sy! * half[1]!;
      return new Vec2(point.x + x * cos - y * sin, point.y + x * sin + y * cos);
    }),
  );
}

/** A body's two most recent fixed poses, in the XY plane. */
interface Pose {
  previousX: number;
  previousY: number;
  previousAngle: number;
  x: number;
  y: number;
  angle: number;
}

function poseOf(body: Body): Pose {
  const p = body.getPosition();
  const angle = body.getAngle();
  return { previousX: p.x, previousY: p.y, previousAngle: angle, x: p.x, y: p.y, angle };
}

/**
 * Shift current to previous and record the new pose. A move far larger than the step's velocity
 * allows is a teleport, so the previous pose snaps to it rather than blending across the jump.
 */
function advance(pose: Pose, body: Body, dt: number): void {
  const p = body.getPosition();
  const angle = body.getAngle();
  const v = body.getLinearVelocity();
  const jumped = Math.hypot(p.x - pose.x, p.y - pose.y) > Math.hypot(v.x, v.y) * dt * 4 + 0.1;
  pose.previousX = jumped ? p.x : pose.x;
  pose.previousY = jumped ? p.y : pose.y;
  pose.previousAngle = jumped ? angle : pose.angle;
  pose.x = p.x;
  pose.y = p.y;
  pose.angle = angle;
}

/** Between two angles along the shorter arc, in radians. */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
