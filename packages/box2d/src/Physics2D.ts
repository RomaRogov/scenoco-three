import { Vec2, World, type Body, type Contact } from 'planck';
import { Vector2, type Object3D } from 'three';
import { System, sendMessage } from '@scenoco-three/core';
import { Rigidbody2D } from './Rigidbody2D.js';
import { applyWorldPose, worldPose } from './transform.js';

/**
 * The 2D physics world, on planck — a pure-JS Box2D port, so there is no async init. Unity's
 * `Physics2D`: made by the first `Rigidbody2D` that wakes, and set up through its statics —
 * `Physics2D.gravity.set(0, 0)` for a game with no gravity.
 *
 * The simulation runs in the **XY plane**: a body's position drives the node's x and y, and its
 * angle drives `rotation.z`. Z is left alone, so a 2D game can still lay its art out in depth.
 *
 * Nothing is rediscovered per step: a body joins in `awake` and leaves in `onDestroy`, a collider
 * attaches itself, and the system holds a world and steps it.
 */
export class Physics2D extends System {
  /** Gravity, in metres per second squared — Unity's `Physics2D.gravity`. Read every step. */
  static readonly gravity = new Vector2(0, -9.81);
  /** Velocity solver iterations per step. Higher is more accurate and slower. */
  static velocityIterations = 8;
  /** Position solver iterations per step. */
  static positionIterations = 3;

  /** The live planck world. Reach for it when the wrapper does not expose something. */
  get world(): World {
    return this._world;
  }

  private _world!: World;

  /** Every body in the world, so `update` can interpolate the dynamic ones. */
  private readonly bodies = new Set<Rigidbody2D>();
  /** Per dynamic body, its two most recent fixed poses. */
  private readonly poses = new Map<Rigidbody2D, Pose>();
  /** Contacts raised during a step, dispatched after it returns. */
  private readonly contacts: QueuedContact[] = [];

  override awake(): void {
    this._world = new World({ gravity: new Vec2(Physics2D.gravity.x, Physics2D.gravity.y) });
    // Resolved to nodes at event time and dispatched after the step: a hook is free to destroy
    // things, and the node stays valid even when the body that raised the contact does not.
    this.world.on('begin-contact', (contact) => this.queue(contact, 'enter'));
    this.world.on('end-contact', (contact) => this.queue(contact, 'exit'));
  }

  override onDestroy(): void {
    for (const rigidbody of this.bodies) rigidbody.releaseBody();
    this.bodies.clear();
    this.poses.clear();
    this.contacts.length = 0;
  }

  // --- membership ------------------------------------------------------------------------

  /** @internal called by `Rigidbody2D.awake`. */
  createBody(rigidbody: Rigidbody2D): Body {
    const { x, y, angle } = worldPose(rigidbody.node);
    const body = this.world.createBody({
      type: rigidbody.bodyType,
      position: new Vec2(x, y),
      angle,
      linearDamping: rigidbody.linearDamping,
      angularDamping: rigidbody.angularDamping,
      fixedRotation: rigidbody.fixedRotation,
      gravityScale: rigidbody.gravityScale,
      bullet: rigidbody.bullet,
    });
    body.setUserData(rigidbody);
    this.bodies.add(rigidbody);
    if (rigidbody.bodyType === 'dynamic') this.poses.set(rigidbody, poseOf(body));
    return body;
  }

  /** @internal called by `Rigidbody2D.onDestroy`. */
  destroyBody(rigidbody: Rigidbody2D): void {
    if (rigidbody.body) this.world.destroyBody(rigidbody.body);
    this.bodies.delete(rigidbody);
    this.poses.delete(rigidbody);
  }

  /** @internal drop the interpolation history, so a teleport does not blend across the jump. */
  resetInterpolation(rigidbody: Rigidbody2D): void {
    if (rigidbody.body && this.poses.has(rigidbody)) {
      this.poses.set(rigidbody, poseOf(rigidbody.body));
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
  syncTransforms(): void {
    for (const rigidbody of this.bodies) {
      if (!rigidbody.body) continue;
      rigidbody.syncFromNode();
      // Otherwise the first frame after the sync interpolates from the pose the body used to
      // have, and the node visibly snaps back before catching up.
      this.resetInterpolation(rigidbody);
    }
  }

  // --- the step --------------------------------------------------------------------------

  override fixedUpdate(dt: number): void {
    // Kinematic bodies are driven by their node: game code moves the node, the body follows and
    // pushes dynamic bodies out of the way. Every `fixedUpdate` that moves one has already run,
    // which is exactly why a system's phase comes after a component's.
    for (const rigidbody of this.bodies) {
      if (rigidbody.bodyType === 'kinematic' && rigidbody.isActiveAndEnabled) rigidbody.syncFromNode();
    }

    this.world.setGravity(new Vec2(Physics2D.gravity.x, Physics2D.gravity.y));
    this.world.step(dt, Physics2D.velocityIterations, Physics2D.positionIterations);

    for (const [rigidbody, pose] of this.poses) {
      if (!rigidbody.isActiveAndEnabled || !rigidbody.body) continue;
      advance(pose, rigidbody.body, dt);
    }

    this.flushContacts();
  }

  /**
   * Blend each dynamic body's node between its last two fixed poses, so motion stays smooth
   * when the render rate and the fixed rate differ.
   */
  override update(): void {
    const t = this.runtime.interpolationAlpha;
    for (const [rigidbody, pose] of this.poses) {
      // A disabled body's node belongs to whatever script disabled it.
      if (!rigidbody.isActiveAndEnabled) continue;
      applyWorldPose(
        rigidbody.node,
        pose.previousX + (pose.x - pose.previousX) * t,
        pose.previousY + (pose.y - pose.previousY) * t,
        lerpAngle(pose.previousAngle, pose.angle, t),
      );
    }
  }

  // --- contacts --------------------------------------------------------------------------

  private queue(contact: Contact, phase: ContactPhase): void {
    const a = contact.getFixtureA();
    const b = contact.getFixtureB();
    const bodyA = a.getBody().getUserData() as Rigidbody2D | undefined;
    const bodyB = b.getBody().getUserData() as Rigidbody2D | undefined;
    if (!bodyA || !bodyB) return;
    this.contacts.push({
      a: bodyA.node,
      b: bodyB.node,
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

/** Tell every behaviour on `node` about `other`: Unity's contact messages, by name. */
function dispatch(node: Object3D, other: Object3D, sensor: boolean, phase: ContactPhase): void {
  const message = sensor
    ? phase === 'enter' ? 'onTriggerEnter2D' : 'onTriggerExit2D'
    : phase === 'enter' ? 'onCollisionEnter2D' : 'onCollisionExit2D';
  sendMessage(node, message, other);
}

/** Interpolate between two angles along the shortest arc, in radians. */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
