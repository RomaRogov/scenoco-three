import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3, type Object3D } from 'three';
import { System, system } from '@scenoco-three/core';
import { RigidBody } from './RigidBody.js';
import { Collider } from './Collider.js';
import { Physics } from './Physics.js';

/** Optional 3D contact callbacks a component may implement (Unity-style names). */
interface ContactHandlers {
  /** A non-sensor collision began with `other`'s node. */
  onCollisionEnter?(other: Object3D): void;
  /** A non-sensor collision ended with `other`'s node. */
  onCollisionExit?(other: Object3D): void;
  /** A sensor (trigger) overlap began with `other`'s node. */
  onTriggerEnter?(other: Object3D): void;
  /** A sensor (trigger) overlap ended with `other`'s node. */
  onTriggerExit?(other: Object3D): void;
}

/** A queued contact, resolved to nodes at event time and dispatched after the step. */
interface QueuedContact {
  a: Object3D;
  b: Object3D;
  sensor: boolean;
  phase: 'enter' | 'exit';
}

/** Previous + current fixed-step pose of a dynamic body, for render interpolation. */
interface Interp {
  pPos: Vector3;
  pQuat: Quaternion;
  cPos: Vector3;
  cQuat: Quaternion;
}

/**
 * ECS-hybrid physics: registered for `RigidBody`, the engine auto-runs it while
 * the scene contains rigid bodies and keeps `this.components` in sync. Each fixed
 * step it reconciles the Rapier world with the live component set (creating a
 * body for each new `RigidBody`, removing one whose component left), steps the
 * world, then writes every body's pose back to its `Object3D`. Gravity comes from
 * the `<Physics>` config attachment, read on attach.
 *
 * Contacts are dispatched to components via duck-typed Unity-style hooks
 * (`onCollisionEnter` / `onTriggerEnter` / …). They are collected from Rapier's
 * event queue during the step and delivered after it returns, so a hook may
 * safely mutate the scene (e.g. destroy a node) without corrupting the world.
 *
 * Requires `await initRapier()` before `loadScene`.
 */
@system(RigidBody)
export class PhysicsSystem extends System<RigidBody> {
  world?: RAPIER.World;
  private events?: RAPIER.EventQueue;
  private readonly bodies = new Map<RigidBody, RAPIER.RigidBody>();
  /** Collider handle → its node + sensor flag, for resolving collision events. */
  private readonly colliderMeta = new Map<number, { node: Object3D; sensor: boolean }>();
  /** Collider handles each body owns, so they can be forgotten when it's removed. */
  private readonly bodyColliders = new Map<RigidBody, number[]>();
  /** Per dynamic body: the two most recent fixed poses, lerped at render time. */
  private readonly interp = new Map<RigidBody, Interp>();
  /** Pooled contact records; `contactCount` is the live prefix reused each step (no per-event allocation). */
  private readonly contacts: QueuedContact[] = [];
  private contactCount = 0;
  private readonly v = new Vector3();
  private readonly q = new Quaternion();

  override onAttach(): void {
    if (typeof RAPIER.World !== 'function') {
      throw new Error('Rapier is not initialized — call `await initRapier()` before loadScene().');
    }
    const g = this.engine.findAttachment(Physics)?.gravity ?? [0, -9.81, 0];
    this.world = new RAPIER.World({ x: g[0] ?? 0, y: g[1] ?? -9.81, z: g[2] ?? 0 });
    this.events = new RAPIER.EventQueue(true);
  }

  override fixedStep(dt: number): void {
    const world = this.world;
    if (!world) return;
    // Reconcile bodies ↔ live components: create for new, remove for gone.
    for (const rb of this.components) if (!this.bodies.has(rb)) this.createBody(world, rb);
    for (const [rb, body] of this.bodies) {
      if (!this.components.includes(rb)) {
        world.removeRigidBody(body);
        this.bodies.delete(rb);
        this.interp.delete(rb);
        rb.body = undefined;
        for (const h of this.bodyColliders.get(rb) ?? []) this.colliderMeta.delete(h);
        this.bodyColliders.delete(rb);
      }
    }
    world.timestep = dt;
    world.step(this.events);
    this.drainEvents();
    // World → scene graph. Dynamic bodies record prev/cur poses for the render
    // interpolation in `step`; fixed/kinematic write straight through.
    for (const [rb, body] of this.bodies) {
      const t = body.translation();
      const r = body.rotation();
      const s = this.interp.get(rb);
      if (s) {
        // Snap rather than blend across a teleport (respawn / setTranslation):
        // a per-step move beyond what this step's velocity allows is a jump.
        const v = body.linvel();
        const moved = Math.hypot(t.x - s.cPos.x, t.y - s.cPos.y, t.z - s.cPos.z);
        if (moved > Math.hypot(v.x, v.y, v.z) * dt * TELEPORT_FACTOR + TELEPORT_MARGIN) {
          s.pPos.set(t.x, t.y, t.z);
          s.pQuat.set(r.x, r.y, r.z, r.w);
        } else {
          s.pPos.copy(s.cPos);
          s.pQuat.copy(s.cQuat);
        }
        s.cPos.set(t.x, t.y, t.z);
        s.cQuat.set(r.x, r.y, r.z, r.w);
      } else {
        rb.node.position.set(t.x, t.y, t.z);
        rb.node.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
    this.flushContacts();
  }

  /**
   * Per-frame: blend each dynamic body's node between its last two fixed poses by
   * `engine.interpolationAlpha`, so motion is smooth even when the render rate
   * differs from the fixed rate. Non-dynamic bodies are written in `fixedStep`.
   */
  override step(): void {
    const a = this.engine.interpolationAlpha;
    for (const [rb, s] of this.interp) {
      rb.node.position.lerpVectors(s.pPos, s.cPos, a);
      rb.node.quaternion.slerpQuaternions(s.pQuat, s.cQuat, a);
    }
  }

  override onDetach(): void {
    for (const rb of this.bodies.keys()) rb.body = undefined;
    this.world?.free();
    this.world = undefined;
    this.events?.free();
    this.events = undefined;
    this.bodies.clear();
    this.interp.clear();
    this.colliderMeta.clear();
    this.bodyColliders.clear();
    this.contacts.length = 0;
    this.contactCount = 0;
  }

  /** The live Rapier body for a RigidBody, once built (for RigidBody.applyImpulse, etc.). */
  bodyFor(rb: RigidBody): RAPIER.RigidBody | undefined {
    return this.bodies.get(rb);
  }

  private createBody(world: RAPIER.World, rb: RigidBody): void {
    rb.node.getWorldPosition(this.v);
    rb.node.getWorldQuaternion(this.q);
    const desc = descForKind(rb.kind)
      .setTranslation(this.v.x, this.v.y, this.v.z)
      .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w })
      .setLinearDamping(rb.linearDamping)
      .setAngularDamping(rb.angularDamping)
      .setGravityScale(rb.gravityScale)
      .setCcdEnabled(rb.ccd);
    const body = world.createRigidBody(desc);
    this.bodies.set(rb, body);
    rb.body = body;
    // Seed interpolation (dynamic bodies only) with the spawn pose, so the first
    // rendered frames don't blend in from a stale origin.
    if (rb.kind === 'dynamic') {
      const t = body.translation();
      const r = body.rotation();
      this.interp.set(rb, {
        pPos: new Vector3(t.x, t.y, t.z),
        pQuat: new Quaternion(r.x, r.y, r.z, r.w),
        cPos: new Vector3(t.x, t.y, t.z),
        cQuat: new Quaternion(r.x, r.y, r.z, r.w),
      });
    }
    // Attach the colliders declared on the same node, recording each handle so
    // collision events (which carry collider handles) resolve back to the node.
    const handles: number[] = [];
    for (const c of rb.engine.getComponents(rb.node)) {
      if (!(c instanceof Collider)) continue;
      const collider = world.createCollider(c.toDesc(), body);
      this.colliderMeta.set(collider.handle, { node: rb.node, sensor: c.isSensor });
      handles.push(collider.handle);
    }
    this.bodyColliders.set(rb, handles);
  }

  /** Pull this step's started/stopped contacts into the pooled queue, resolved to nodes. */
  private drainEvents(): void {
    this.events?.drainCollisionEvents((h1, h2, started) => {
      const a = this.colliderMeta.get(h1);
      const b = this.colliderMeta.get(h2);
      if (!a || !b) return; // a side was removed this step — drop the stale event
      // Reuse a pooled record (grow the pool once), so a busy contact frame allocates nothing.
      let c = this.contacts[this.contactCount];
      if (c) { c.a = a.node; c.b = b.node; c.sensor = a.sensor || b.sensor; c.phase = started ? 'enter' : 'exit'; }
      else this.contacts[this.contactCount] = c = { a: a.node, b: b.node, sensor: a.sensor || b.sensor, phase: started ? 'enter' : 'exit' };
      this.contactCount++;
    });
  }

  private flushContacts(): void {
    // Dispatch the live prefix in place, then reset the count (records stay pooled).
    // Deferred destruction means a hook can't splice the world mid-loop.
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
      const h = c as unknown as ContactHandlers;
      const fn = sensor
        ? phase === 'enter'
          ? h.onTriggerEnter
          : h.onTriggerExit
        : phase === 'enter'
          ? h.onCollisionEnter
          : h.onCollisionExit;
      fn?.call(c, other);
    }
  }
}

/** Teleport detection for interpolation — a per-step move beyond `velocity·dt·FACTOR + MARGIN` snaps rather than blends. */
const TELEPORT_FACTOR = 4;
const TELEPORT_MARGIN = 0.1;

function descForKind(kind: string): RAPIER.RigidBodyDesc {
  if (kind === 'fixed') return RAPIER.RigidBodyDesc.fixed();
  if (kind === 'kinematic') return RAPIER.RigidBodyDesc.kinematicPositionBased();
  return RAPIER.RigidBodyDesc.dynamic();
}
