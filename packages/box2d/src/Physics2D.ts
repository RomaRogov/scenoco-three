import { Vec2, World, type Body, type Contact } from 'planck';
import { Vector2, type Object3D } from 'three';
import { Component, System, Time } from '@scenoco-three/core';
import { RigidBody2D } from './RigidBody2D.js';

/**
 * The 2D physics world, on planck — a pure-JS Box2D port, so there is no async init.
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <Physics2D gravity="x: 0; y: -9.81" />
 *   </Systems>
 * </Scene>
 * ```
 *
 * Declaring it is optional: the first `<RigidBody2D>` calls `requireSystem` and gets a world
 * with default gravity. Declaring one only configures it.
 *
 * The simulation runs in the **XY plane**: a body's position drives the node's x and y, and its
 * angle drives `rotation.z`. Z is left alone, so a 2D game can still lay its art out in depth.
 *
 * Nothing is rediscovered per step: a body joins in `awake` and leaves in `onDestroy`, a collider
 * attaches itself, and the system holds a world and steps it.
 */
export class Physics2D extends System {
  /** Gravity, in metres per second squared. */
  gravity = new Vector2(0, -9.81);
  /** Velocity solver iterations per step. Higher is more accurate and slower. */
  velocityIterations = 8;
  /** Position solver iterations per step. */
  positionIterations = 3;

  /** The live planck world. Reach for it when the wrapper does not expose something. */
  world!: World;

  /** Every body in the world, so `update` can interpolate the dynamic ones. */
  private readonly bodies = new Set<RigidBody2D>();
  /** Per dynamic body, its two most recent fixed poses. */
  private readonly poses = new Map<RigidBody2D, Pose>();
  /** Contacts raised during a step, dispatched after it returns. */
  private readonly contacts: QueuedContact[] = [];

  override awake(): void {
    this.world = new World({ gravity: new Vec2(this.gravity.x, this.gravity.y) });
    // Resolved to nodes at event time and dispatched after the step: a hook is free to destroy
    // things, and the node stays valid even when the body that raised the contact does not.
    this.world.on('begin-contact', (contact) => this.queue(contact, 'enter'));
    this.world.on('end-contact', (contact) => this.queue(contact, 'exit'));
  }

  override onDestroy(): void {
    for (const rigidBody of this.bodies) rigidBody.body = null;
    this.bodies.clear();
    this.poses.clear();
    this.contacts.length = 0;
  }

  // --- membership ------------------------------------------------------------------------

  /** @internal called by `RigidBody2D.awake`. */
  createBody(rigidBody: RigidBody2D): Body {
    const { position, rotation } = rigidBody.object3D;
    const body = this.world.createBody({
      type: rigidBody.bodyType(),
      position: new Vec2(position.x, position.y),
      angle: rotation.z,
      linearDamping: rigidBody.linearDamping,
      angularDamping: rigidBody.angularDamping,
      fixedRotation: rigidBody.fixedRotation,
      gravityScale: rigidBody.gravityScale,
      bullet: rigidBody.bullet,
    });
    body.setUserData(rigidBody);
    this.bodies.add(rigidBody);
    if (rigidBody.kind === 'dynamic') this.poses.set(rigidBody, poseOf(body));
    return body;
  }

  /** @internal called by `RigidBody2D.onDestroy`. */
  destroyBody(rigidBody: RigidBody2D): void {
    if (rigidBody.body) this.world.destroyBody(rigidBody.body);
    this.bodies.delete(rigidBody);
    this.poses.delete(rigidBody);
  }

  /** @internal drop the interpolation history, so a teleport does not blend across the jump. */
  resetInterpolation(rigidBody: RigidBody2D): void {
    if (rigidBody.body && this.poses.has(rigidBody)) {
      this.poses.set(rigidBody, poseOf(rigidBody.body));
    }
  }

  /**
   * Move every body to where its node now is.
   *
   * Only kinematic bodies follow their node during a step, because for everything else the
   * world is what moves the node, not the other way round. That leaves a gap whenever something
   * outside the simulation writes a transform — an editor gizmo dragging a static platform is
   * the obvious one — and the gap is invisible: the platform is drawn in its new place while
   * its collider stays behind, so things bounce off nothing.
   */
  override syncTransforms(): void {
    for (const rigidBody of this.bodies) {
      if (!rigidBody.body) continue;
      rigidBody.syncFromNode();
      // Otherwise the first frame after the sync interpolates from the pose the body used to
      // have, and the node visibly snaps back before catching up.
      this.resetInterpolation(rigidBody);
    }
  }

  // --- the step --------------------------------------------------------------------------

  override fixedUpdate(dt: number): void {
    // Kinematic bodies are driven by their node: game code moves the node, the body follows and
    // pushes dynamic bodies out of the way. Every `fixedUpdate` that moves one has already run,
    // which is exactly why a system's phase comes after a component's.
    for (const rigidBody of this.bodies) {
      if (rigidBody.kind === 'kinematic' && rigidBody.isActiveAndEnabled) rigidBody.syncFromNode();
    }

    this.world.step(dt, this.velocityIterations, this.positionIterations);

    for (const [rigidBody, pose] of this.poses) {
      if (!rigidBody.isActiveAndEnabled || !rigidBody.body) continue;
      advance(pose, rigidBody.body, dt);
    }

    this.flushContacts();
  }

  /**
   * Blend each dynamic body's node between its last two fixed poses, so motion stays smooth
   * when the render rate and the fixed rate differ.
   */
  override update(): void {
    const t = Time.interpolationAlpha;
    for (const [rigidBody, pose] of this.poses) {
      // A disabled body's node belongs to whatever script disabled it.
      if (!rigidBody.isActiveAndEnabled) continue;
      const node = rigidBody.object3D;
      node.position.x = pose.previousX + (pose.x - pose.previousX) * t;
      node.position.y = pose.previousY + (pose.y - pose.previousY) * t;
      node.rotation.z = lerpAngle(pose.previousAngle, pose.angle, t);
    }
  }

  // --- contacts --------------------------------------------------------------------------

  private queue(contact: Contact, phase: ContactPhase): void {
    const a = contact.getFixtureA();
    const b = contact.getFixtureB();
    const bodyA = a.getBody().getUserData() as RigidBody2D | undefined;
    const bodyB = b.getBody().getUserData() as RigidBody2D | undefined;
    if (!bodyA || !bodyB) return;
    this.contacts.push({
      a: bodyA.object3D,
      b: bodyB.object3D,
      sensor: a.isSensor() || b.isSensor(),
      phase,
    });
  }

  private flushContacts(): void {
    // Both sides hear about it, and both hear the same thing.
    for (const { a, b, sensor, phase } of this.contacts) {
      dispatch(a, b, sensor, phase);
      dispatch(b, a, sensor, phase);
    }
    this.contacts.length = 0;
  }
}

type ContactPhase = 'enter' | 'exit';

interface QueuedContact {
  a: Object3D;
  b: Object3D;
  sensor: boolean;
  phase: ContactPhase;
}

/** A dynamic body's two most recent fixed poses, in the XY plane. */
interface Pose {
  previousX: number;
  previousY: number;
  previousAngle: number;
  x: number;
  y: number;
  angle: number;
}

function poseOf(body: Body): Pose {
  const position = body.getPosition();
  const angle = body.getAngle();
  return {
    previousX: position.x,
    previousY: position.y,
    previousAngle: angle,
    x: position.x,
    y: position.y,
    angle,
  };
}

/**
 * Shift current → previous and record the new pose.
 *
 * A move far larger than this step's velocity allows is a teleport — a respawn, a manual
 * `setPosition` — so the previous pose snaps to it rather than being blended across the jump.
 * The threshold scales with speed, so a genuinely fast body is not mistaken for one.
 */
function advance(pose: Pose, body: Body, dt: number): void {
  const position = body.getPosition();
  const angle = body.getAngle();
  const velocity = body.getLinearVelocity();
  const moved = Math.hypot(position.x - pose.x, position.y - pose.y);
  const allowed = Math.hypot(velocity.x, velocity.y) * dt * TELEPORT_FACTOR + TELEPORT_MARGIN;

  if (moved > allowed) {
    pose.previousX = position.x;
    pose.previousY = position.y;
    pose.previousAngle = angle;
  } else {
    pose.previousX = pose.x;
    pose.previousY = pose.y;
    pose.previousAngle = pose.angle;
  }
  pose.x = position.x;
  pose.y = position.y;
  pose.angle = angle;
}

const TELEPORT_FACTOR = 4;
const TELEPORT_MARGIN = 0.1;

/** Call every contact hook on `node` that wants to hear about `other`. */
function dispatch(node: Object3D, other: Object3D, sensor: boolean, phase: ContactPhase): void {
  for (const component of node.components) {
    // Enqueued for destruction this frame: it should not act on a contact it will not survive.
    if (component.isDestroyed || (component as Component)._pendingDestroy) continue;
    const hook = sensor
      ? phase === 'enter'
        ? component.onTriggerEnter2D
        : component.onTriggerExit2D
      : phase === 'enter'
        ? component.onCollisionEnter2D
        : component.onCollisionExit2D;
    hook?.call(component, other);
  }
}

/** Interpolate between two angles along the shortest arc, in radians. */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
