import { World, Vec2, type Body, type BodyType } from 'planck';
import type { Object3D } from 'three';
import { System, system } from '@scenoco-three/core';
import { RigidBody2D } from './RigidBody2D.js';
import { Collider2D } from './Collider2D.js';
import { Physics2D } from './Physics2D.js';

/** Optional 2D contact callbacks a component may implement (Unity-style names). */
interface Contact2DHandlers {
  /** A non-sensor collision began with `other`'s node. */
  onCollisionEnter2D?(other: Object3D): void;
  /** A non-sensor collision ended with `other`'s node. */
  onCollisionExit2D?(other: Object3D): void;
  /** A sensor (trigger) overlap began with `other`'s node. */
  onTriggerEnter2D?(other: Object3D): void;
  /** A sensor (trigger) overlap ended with `other`'s node. */
  onTriggerExit2D?(other: Object3D): void;
}

/** A queued contact, resolved to nodes at event time and dispatched after the step. */
interface QueuedContact {
  a: Object3D;
  b: Object3D;
  sensor: boolean;
  phase: 'enter' | 'exit';
}

/** Previous + current fixed-step XY pose of a dynamic body, for render interpolation. */
interface Interp {
  px: number;
  py: number;
  pa: number;
  x: number;
  y: number;
  a: number;
}

/**
 * ECS-hybrid 2D physics on planck (Box2D). Registered for `RigidBody2D`, the
 * engine auto-runs it while the scene contains 2D bodies and keeps
 * `this.components` in sync. Each fixed step it reconciles the planck world with
 * the live body set, drives kinematic bodies from their nodes, steps the world,
 * and writes dynamic poses back to the XY plane (position → node.x/y, angle →
 * node.rotation.z). Gravity/iterations come from the `<Physics2D>` attachment.
 *
 * Contacts are dispatched to components via duck-typed Unity-style hooks
 * (`onCollisionEnter2D` / `onTriggerEnter2D` / …). They are queued during the
 * step and delivered after it returns, so a hook may safely mutate the scene
 * (e.g. destroy a brick) without corrupting the in-progress simulation.
 *
 * No async init is required — planck is pure JS.
 */
@system(RigidBody2D)
export class Physics2DSystem extends System<RigidBody2D> {
  world?: World;
  private readonly bodies = new Map<RigidBody2D, Body>();
  /** Per dynamic body: the two most recent fixed poses, lerped at render time. */
  private readonly interp = new Map<RigidBody2D, Interp>();
  /** Pooled contact records; `contactCount` is the live prefix reused each step (no per-event allocation). */
  private readonly contacts: QueuedContact[] = [];
  private contactCount = 0;

  override onAttach(): void {
    const cfg = this.engine.findAttachment(Physics2D);
    const g = cfg?.gravity ?? [0, -9.81];
    this.world = new World({ gravity: new Vec2(g[0] ?? 0, g[1] ?? -9.81) });
    // Resolve contacts to nodes at event time and queue them; the side of the
    // pair that owns a body may be gone by dispatch, but the nodes stay valid.
    this.world.on('begin-contact', (contact) => this.queue(contact, 'enter'));
    this.world.on('end-contact', (contact) => this.queue(contact, 'exit'));
  }

  override fixedStep(dt: number): void {
    const world = this.world;
    if (!world) return;

    // Reconcile bodies ↔ live components: create for new, remove for gone.
    for (const rb of this.components) if (!this.bodies.has(rb)) this.createBody(world, rb);
    for (const [rb, body] of this.bodies) {
      if (!this.components.includes(rb)) {
        world.destroyBody(body);
        this.bodies.delete(rb);
        this.interp.delete(rb);
        rb.body = undefined;
      }
    }

    // Kinematic bodies are driven by their node (game code moves the node).
    for (const [rb, body] of this.bodies) {
      if (rb.kind === 'kinematic') body.setTransform(new Vec2(rb.node.position.x, rb.node.position.y), rb.node.rotation.z);
    }

    const cfg = this.engine.findAttachment(Physics2D);
    world.step(dt, cfg?.velocityIterations ?? 8, cfg?.positionIterations ?? 3);

    // Dynamic bodies record prev/cur poses for the render interpolation in
    // `step`; kinematic/static are driven elsewhere (kinematic from their node).
    for (const [rb, body] of this.bodies) {
      if (rb.kind !== 'dynamic') continue;
      const p = body.getPosition();
      const angle = body.getAngle();
      const s = this.interp.get(rb)!;
      // A move far beyond what this step's velocity allows is a teleport
      // (respawn, manual setTransform) — snap prev to it so we don't blend
      // across the jump; otherwise shift cur → prev for a normal interpolation.
      const v = body.getLinearVelocity();
      const moved = Math.hypot(p.x - s.x, p.y - s.y);
      if (moved > Math.hypot(v.x, v.y) * dt * TELEPORT_FACTOR + TELEPORT_MARGIN) {
        s.px = p.x;
        s.py = p.y;
        s.pa = angle;
      } else {
        s.px = s.x;
        s.py = s.y;
        s.pa = s.a;
      }
      s.x = p.x;
      s.y = p.y;
      s.a = angle;
    }

    this.flushContacts();
  }

  /**
   * Per-frame: blend each dynamic body's node between its last two fixed poses by
   * `engine.interpolationAlpha`, so XY-plane motion stays smooth when the render
   * rate differs from the fixed rate.
   */
  override step(): void {
    const t = this.engine.interpolationAlpha;
    for (const [rb, s] of this.interp) {
      rb.node.position.x = s.px + (s.x - s.px) * t;
      rb.node.position.y = s.py + (s.y - s.py) * t;
      rb.node.rotation.z = lerpAngle(s.pa, s.a, t);
    }
  }

  override onDetach(): void {
    for (const rb of this.bodies.keys()) rb.body = undefined;
    this.bodies.clear();
    this.interp.clear();
    this.contacts.length = 0;
    this.contactCount = 0;
    this.world = undefined;
  }

  private createBody(world: World, rb: RigidBody2D): void {
    const body = world.createBody({
      type: rb.kind as BodyType,
      position: new Vec2(rb.node.position.x, rb.node.position.y),
      angle: rb.node.rotation.z,
      linearDamping: rb.linearDamping,
      angularDamping: rb.angularDamping,
      fixedRotation: rb.fixedRotation,
      gravityScale: rb.gravityScale,
      bullet: rb.bullet,
    });
    body.setUserData(rb);
    // Attach the colliders declared on the same node.
    for (const c of this.engine.getComponents(rb.node)) {
      if (c instanceof Collider2D) body.createFixture(c.toShape(), c.fixtureOpt());
    }
    this.bodies.set(rb, body);
    rb.body = body;
    // Seed interpolation (dynamic bodies only) with the spawn pose.
    if (rb.kind === 'dynamic') {
      const p = body.getPosition();
      const a = body.getAngle();
      this.interp.set(rb, { px: p.x, py: p.y, pa: a, x: p.x, y: p.y, a });
    }
  }

  private queue(contact: { getFixtureA(): { getBody(): Body; isSensor(): boolean }; getFixtureB(): { getBody(): Body; isSensor(): boolean } }, phase: 'enter' | 'exit'): void {
    const fa = contact.getFixtureA();
    const fb = contact.getFixtureB();
    const rbA = fa.getBody().getUserData() as RigidBody2D | undefined;
    const rbB = fb.getBody().getUserData() as RigidBody2D | undefined;
    if (!rbA || !rbB) return;
    const sensor = fa.isSensor() || fb.isSensor();
    // Reuse a pooled record (grow the pool once), so a busy contact frame allocates nothing.
    let c = this.contacts[this.contactCount];
    if (c) { c.a = rbA.node; c.b = rbB.node; c.sensor = sensor; c.phase = phase; }
    else this.contacts[this.contactCount] = c = { a: rbA.node, b: rbB.node, sensor, phase };
    this.contactCount++;
  }

  private flushContacts(): void {
    // Dispatch the live prefix in place, then reset the count (records stay pooled).
    for (let i = 0; i < this.contactCount; i++) {
      const { a, b, sensor, phase } = this.contacts[i]!;
      this.dispatch(a, b, sensor, phase);
      this.dispatch(b, a, sensor, phase);
    }
    this.contactCount = 0;
  }

  private dispatch(node: Object3D, other: Object3D, sensor: boolean, phase: 'enter' | 'exit'): void {
    for (const c of this.engine.getComponents(node)) {
      if (c._destroyed) continue; // enqueued for destruction this tick — skip its hooks
      const h = c as unknown as Contact2DHandlers;
      const fn = sensor
        ? phase === 'enter'
          ? h.onTriggerEnter2D
          : h.onTriggerExit2D
        : phase === 'enter'
          ? h.onCollisionEnter2D
          : h.onCollisionExit2D;
      fn?.call(c, other);
    }
  }
}

/**
 * Teleport detection for render interpolation: a per-step move larger than
 * `velocity·dt·FACTOR + MARGIN` is treated as a discontinuity (respawn / manual
 * setTransform) and snaps rather than blends. Scales with speed so genuinely
 * fast bodies aren't misflagged.
 */
const TELEPORT_FACTOR = 4;
const TELEPORT_MARGIN = 0.1;

/** Interpolate between two angles along the shortest arc (radians). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
