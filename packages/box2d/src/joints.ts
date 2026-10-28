import { DistanceJoint, FrictionJoint, Mat22, MotorJoint, MouseJoint, PrismaticJoint, RevoluteJoint, RopeJoint, Vec2, WeldJoint, WheelJoint, type Body, type Joint, type TimeStep } from 'planck';
import { MathUtils, Vector2, Vector3 } from 'three';
import { Behaviour, service } from '@scenoco-three/core';
import { Physics2D } from './Physics2D.js';
import { Rigidbody2D } from './Rigidbody2D.js';

/**
 * Unity's `Joint2D`: ties this node's `Rigidbody2D` to `connectedBody`, or to the world where there
 * is none. Settings apply at the next physics step, as Unity's do. Past `breakForce` or
 * `breakTorque` it breaks: `onJointBreak2D(joint)` goes to its node and the joint is destroyed.
 * planck's own joint is `planckJoint`.
 */
export abstract class Joint2D extends Behaviour {
  /** Whether the two joined bodies still collide with each other. */
  enableCollision = false;
  /** The force, in newtons, that breaks it. */
  breakForce = Infinity;
  /** The torque that breaks it. */
  breakTorque = Infinity;

  private _connectedBody: Rigidbody2D | null = null;
  private _joint: Joint | null = null;
  private _physics: Physics2D | null = null;
  /** The settings the joint was made from: a change to one makes it again. */
  private _made = '';
  private readonly _reactionForce = new Vector2();
  private _reactionTorque = 0;

  /** The other body, or null for the world. */
  get connectedBody(): Rigidbody2D | null {
    return this._connectedBody;
  }
  set connectedBody(value: Rigidbody2D | null) {
    this._connectedBody = value;
    if (this._joint) this._remake();
  }

  /** The body this joint is on: the `Rigidbody2D` beside it. */
  get attachedRigidbody(): Rigidbody2D | null {
    return this._node ? this.getComponent(Rigidbody2D) : null;
  }

  /** The force the joint held the bodies with in the last step. */
  get reactionForce(): Vector2 {
    return this._reactionForce.clone();
  }

  /** The torque the joint held the bodies with in the last step. */
  get reactionTorque(): number {
    return this._reactionTorque;
  }

  /** planck's joint, while it is made — for anything Unity's fields do not cover. */
  get planckJoint(): Joint | null {
    return this._joint;
  }

  /** The force over a step of `timeStep` seconds. */
  getReactionForce(timeStep: number): Vector2 {
    const f = this._joint?.getReactionForce(1 / timeStep);
    return new Vector2(f?.x ?? 0, f?.y ?? 0);
  }

  getReactionTorque(timeStep: number): number {
    return this._joint?.getReactionTorque(1 / timeStep) ?? 0;
  }

  /** @internal planck's joint between this body (`a`) and the connected one or the world (`b`). */
  protected abstract make(a: Body, b: Body, connected: Rigidbody2D | null): Joint;

  /** @internal the settings that apply to a made joint, every step. */
  protected configure(_joint: Joint): void {}

  /** @internal the settings that only a new joint takes: where it joins, which way it slides. */
  protected placement(): unknown[] {
    return [];
  }

  // `start`: every body has woken by then, this one's and the connected one's.
  override start(): void {
    this.create();
  }

  override onEnable(): void {
    if (this._started) this.create();
  }

  override onDisable(): void {
    this.remove();
  }

  override onDestroy(): void {
    this.remove();
  }

  /** @internal before a step: settings onto the joint, or a new joint when a placement changed. */
  _sync(): void {
    const joint = this._joint;
    if (!joint) return;
    if (this.key() !== this._made) this._remake();
    else this.configure(joint);
  }

  /** @internal after a step: what it held with, and whether that broke it. */
  _measure(invDt: number): boolean {
    const joint = this._joint;
    if (!joint) return false;
    const f = joint.getReactionForce(invDt);
    this._reactionForce.set(f.x, f.y);
    this._reactionTorque = joint.getReactionTorque(invDt);
    if (this._reactionForce.length() <= this.breakForce && Math.abs(this._reactionTorque) <= this.breakTorque) return false;
    this.remove();
    return true;
  }

  /** @internal planck took the joint away with a body it held. */
  _lost(joint: Joint): void {
    if (joint !== this._joint) return;
    this._physics?.joints.delete(this);
    this._joint = null;
  }

  private _remake(): void {
    this.remove();
    this.create();
  }

  private key(): string {
    return JSON.stringify([this.enableCollision, ...this.placement()]);
  }

  private create(): void {
    if (this._joint || !this.enabled) return;
    const own = this.attachedRigidbody;
    if (!own?.planckBody) {
      throw new Error(`${this.constructor.name} on "${this.node.name}" needs a Rigidbody2D on the same node, as in Unity: <Rigidbody2D /> beside it.`);
    }
    const other = this._connectedBody;
    if (other && !other.planckBody) throw new Error(`${this.constructor.name} on "${this.node.name}": its connectedBody has no body — is it in the scene, and enabled?`);
    const physics = (this._physics = service(this.node, Physics2D));
    const joint = this.make(own.planckBody, other?.planckBody ?? physics._ground(), other);
    joint.setUserData(this);
    physics.world.createJoint(joint);
    physics.joints.add(this);
    this._joint = joint;
    this._made = this.key();
    this.configure(joint);
  }

  private remove(): void {
    const joint = this._joint;
    if (!joint) return;
    this._joint = null;
    this._physics?.joints.delete(this);
    this._physics?.world.destroyJoint(joint);
  }
}

/**
 * Unity's `AnchoredJoint2D`: joins at `anchor` on this body and `connectedAnchor` on the connected
 * one — in the world, without one. With `autoConfigureConnectedAnchor` the connected anchor is
 * where `anchor` is when the joint is made, so the bodies are held as they stand.
 */
export abstract class AnchoredJoint2D extends Joint2D {
  /** Where it joins this body, in its node's space. */
  anchor = new Vector2();
  /** Where it joins the connected body, in its node's space — or in the world, with none. */
  connectedAnchor = new Vector2();
  autoConfigureConnectedAnchor = true;

  protected override placement(): unknown[] {
    return [this.anchor.x, this.anchor.y, this.connectedAnchor.x, this.connectedAnchor.y];
  }

  /** @internal both anchors in their bodies' spaces, working out the connected one when asked. */
  protected anchors(a: Body, b: Body, connected: Rigidbody2D | null): { localAnchorA: Vec2; localAnchorB: Vec2 } {
    const localAnchorA = scaled(this.anchor, this.node.getWorldScale(SCALE));
    const otherScale = connected ? connected.node.getWorldScale(SCALE2) : ONE;
    if (this.autoConfigureConnectedAnchor) {
      const local = b.getLocalPoint(a.getWorldPoint(localAnchorA));
      this.connectedAnchor.set(local.x / otherScale.x, local.y / otherScale.y);
    }
    return { localAnchorA, localAnchorB: scaled(this.connectedAnchor, otherScale) };
  }
}

/** Unity's `JointMotor2D`: turns towards `motorSpeed` — degrees a second, or metres for a slider — with at most `maxMotorTorque`. */
export interface JointMotor2D {
  motorSpeed: number;
  maxMotorTorque: number;
}

/** Unity's `JointAngleLimits2D`, in degrees from where the joint started. */
export interface JointAngleLimits2D {
  min: number;
  max: number;
}

/** Unity's `JointTranslationLimits2D`, in metres from where the joint started. */
export interface JointTranslationLimits2D {
  min: number;
  max: number;
}

/** Unity's `JointSuspension2D`: a wheel's spring, along `angle` degrees in the world. */
export interface JointSuspension2D {
  dampingRatio: number;
  frequency: number;
  angle: number;
}

/** Unity's `FixedJoint2D`: the two keep the pose they started in, as if glued — springy with a `frequency`. */
export class FixedJoint2D extends AnchoredJoint2D {
  /** How fast it springs back, in hertz: 0 is rigid. */
  frequency = 0;
  dampingRatio = 0;

  /** Degrees between the two bodies the joint holds. */
  get referenceAngle(): number {
    return MathUtils.radToDeg((this.planckJoint as WeldJoint | null)?.getReferenceAngle() ?? 0);
  }

  protected make(a: Body, b: Body, connected: Rigidbody2D | null): Joint {
    return new WeldJoint({ bodyA: a, bodyB: b, ...this.anchors(a, b, connected), referenceAngle: b.getAngle() - a.getAngle(), collideConnected: this.enableCollision });
  }

  protected override configure(joint: WeldJoint): void {
    joint.setFrequency(this.frequency);
    joint.setDampingRatio(this.dampingRatio);
  }
}

/**
 * Unity's `HingeJoint2D`: the two turn about one point — a door, a flipper, a pendulum. As in Unity,
 * the angle is the connected body's turn against this one, counter-clockwise; `useLimits` keeps it
 * within `limits`, `useMotor` drives it.
 */
export class HingeJoint2D extends AnchoredJoint2D {
  useLimits = false;
  limits: JointAngleLimits2D = { min: 0, max: 359 };
  useMotor = false;
  motor: JointMotor2D = { motorSpeed: 0, maxMotorTorque: 10000 };

  /** Degrees from where it started. */
  get jointAngle(): number {
    return MathUtils.radToDeg((this.planckJoint as RevoluteJoint | null)?.getJointAngle() ?? 0);
  }

  /** Degrees a second. */
  get jointSpeed(): number {
    return MathUtils.radToDeg((this.planckJoint as RevoluteJoint | null)?.getJointSpeed() ?? 0);
  }

  getMotorTorque(timeStep: number): number {
    return (this.planckJoint as RevoluteJoint | null)?.getMotorTorque(1 / timeStep) ?? 0;
  }

  protected make(a: Body, b: Body, connected: Rigidbody2D | null): Joint {
    return new RevoluteJoint({ bodyA: a, bodyB: b, ...this.anchors(a, b, connected), referenceAngle: b.getAngle() - a.getAngle(), collideConnected: this.enableCollision });
  }

  protected override configure(joint: RevoluteJoint): void {
    joint.enableLimit(this.useLimits);
    joint.setLimits(MathUtils.degToRad(this.limits.min), MathUtils.degToRad(this.limits.max));
    joint.enableMotor(this.useMotor);
    joint.setMotorSpeed(MathUtils.degToRad(this.motor.motorSpeed));
    joint.setMaxMotorTorque(this.motor.maxMotorTorque);
  }
}

/**
 * Unity's `DistanceJoint2D`: keeps the anchors `distance` apart, as a rod — or at most that far, as a
 * rope, with `maxDistanceOnly`. `autoConfigureDistance` takes the distance they start at.
 */
export class DistanceJoint2D extends AnchoredJoint2D {
  /** Off, as in Unity: the rod runs from `anchor` to `connectedAnchor`, the other body's origin unless moved. */
  override autoConfigureConnectedAnchor = false;
  autoConfigureDistance = true;
  distance = 1;
  maxDistanceOnly = false;

  protected override placement(): unknown[] {
    return [...super.placement(), this.maxDistanceOnly];
  }

  protected make(a: Body, b: Body, connected: Rigidbody2D | null): Joint {
    const anchors = this.anchors(a, b, connected);
    if (this.autoConfigureDistance) this.distance = startDistance(a, b, anchors);
    const def = { bodyA: a, bodyB: b, ...anchors, collideConnected: this.enableCollision };
    return this.maxDistanceOnly ? new RopeJoint({ ...def, maxLength: this.distance }) : new DistanceJoint({ ...def, length: this.distance });
  }

  protected override configure(joint: DistanceJoint | RopeJoint): void {
    if (joint instanceof RopeJoint) joint.setMaxLength(this.distance);
    else joint.setLength(this.distance);
  }
}

/** Unity's `SpringJoint2D`: pulls the anchors back to `distance` apart, springing at `frequency` hertz. */
export class SpringJoint2D extends AnchoredJoint2D {
  /** Off, as in Unity: the spring runs from `anchor` to `connectedAnchor`, the other body's origin unless moved. */
  override autoConfigureConnectedAnchor = false;
  autoConfigureDistance = true;
  distance = 1;
  /** 0 bounces on, 1 settles without overshooting. */
  dampingRatio = 0;
  /** How fast it springs, in hertz. */
  frequency = 1;

  protected make(a: Body, b: Body, connected: Rigidbody2D | null): Joint {
    const anchors = this.anchors(a, b, connected);
    if (this.autoConfigureDistance) this.distance = startDistance(a, b, anchors);
    return new DistanceJoint({ bodyA: a, bodyB: b, ...anchors, length: this.distance, collideConnected: this.enableCollision });
  }

  protected override configure(joint: DistanceJoint): void {
    joint.setLength(this.distance);
    joint.setFrequency(this.frequency);
    joint.setDampingRatio(this.dampingRatio);
  }
}

/**
 * Unity's `SliderJoint2D`: slides along one line, `angle` degrees in the world as it starts, without
 * turning — a lift, a piston. `useLimits` keeps it within `limits`, `useMotor` drives it.
 */
export class SliderJoint2D extends AnchoredJoint2D {
  /** The line it slides along, in degrees counter-clockwise from x, in the world. */
  angle = 0;
  /** Takes `angle` from the line between the anchors as it starts. */
  autoConfigureAngle = false;
  useLimits = false;
  limits: JointTranslationLimits2D = { min: 0, max: 0 };
  useMotor = false;
  motor: JointMotor2D = { motorSpeed: 0, maxMotorTorque: 10000 };

  /** How far it has slid, in metres. */
  get jointTranslation(): number {
    return (this.planckJoint as PrismaticJoint | null)?.getJointTranslation() ?? 0;
  }

  /** Metres a second. */
  get jointSpeed(): number {
    return (this.planckJoint as PrismaticJoint | null)?.getJointSpeed() ?? 0;
  }

  protected override placement(): unknown[] {
    return [...super.placement(), this.angle];
  }

  protected make(a: Body, b: Body, connected: Rigidbody2D | null): Joint {
    const anchors = this.anchors(a, b, connected);
    if (this.autoConfigureAngle) {
      const from = a.getWorldPoint(anchors.localAnchorA);
      const to = b.getWorldPoint(anchors.localAnchorB);
      if (Math.hypot(to.x - from.x, to.y - from.y) > 1e-6) this.angle = MathUtils.radToDeg(Math.atan2(to.y - from.y, to.x - from.x));
    }
    return new PrismaticJoint({ bodyA: a, bodyB: b, ...anchors, localAxisA: axis(a, this.angle), referenceAngle: b.getAngle() - a.getAngle(), collideConnected: this.enableCollision });
  }

  protected override configure(joint: PrismaticJoint): void {
    joint.enableLimit(this.useLimits);
    joint.setLimits(this.limits.min, this.limits.max);
    joint.enableMotor(this.useMotor);
    joint.setMotorSpeed(this.motor.motorSpeed);
    joint.setMaxMotorForce(this.motor.maxMotorTorque);
  }
}

/**
 * Unity's `WheelJoint2D`: on the car's body, with the wheel as `connectedBody` — the wheel turns
 * freely and rides a `suspension` spring. `useMotor` drives it, in degrees a second.
 */
export class WheelJoint2D extends AnchoredJoint2D {
  suspension: JointSuspension2D = { dampingRatio: 0.7, frequency: 2, angle: 90 };
  useMotor = false;
  motor: JointMotor2D = { motorSpeed: 0, maxMotorTorque: 10000 };

  /** How far the suspension is from where it started, in metres. */
  get jointTranslation(): number {
    return (this.planckJoint as WheelJoint | null)?.getJointTranslation() ?? 0;
  }

  /** How fast the wheel turns, in degrees a second. */
  get jointAngularSpeed(): number {
    return MathUtils.radToDeg((this.planckJoint as WheelJoint | null)?.getJointSpeed() ?? 0);
  }

  getMotorTorque(timeStep: number): number {
    return (this.planckJoint as WheelJoint | null)?.getMotorTorque(1 / timeStep) ?? 0;
  }

  protected override placement(): unknown[] {
    return [...super.placement(), this.suspension.angle];
  }

  protected make(a: Body, b: Body, connected: Rigidbody2D | null): Joint {
    return new WheelJoint({ bodyA: a, bodyB: b, ...this.anchors(a, b, connected), localAxisA: axis(a, this.suspension.angle), collideConnected: this.enableCollision });
  }

  protected override configure(joint: WheelJoint): void {
    joint.setSpringFrequencyHz(this.suspension.frequency);
    joint.setSpringDampingRatio(this.suspension.dampingRatio);
    joint.enableMotor(this.useMotor);
    joint.setMotorSpeed(MathUtils.degToRad(this.motor.motorSpeed));
    joint.setMaxMotorTorque(this.motor.maxMotorTorque);
  }
}

/** Unity's `FrictionJoint2D`: slows the two against each other, or against the world — top-down drag. */
export class FrictionJoint2D extends AnchoredJoint2D {
  maxForce = 1;
  maxTorque = 1;

  protected make(a: Body, b: Body, connected: Rigidbody2D | null): Joint {
    return new SteadyFrictionJoint({ bodyA: a, bodyB: b, ...this.anchors(a, b, connected), collideConnected: this.enableCollision });
  }

  protected override configure(joint: FrictionJoint): void {
    joint.setMaxForce(this.maxForce);
    joint.setMaxTorque(this.maxTorque);
  }
}

/**
 * Unity's `RelativeJoint2D`: holds the connected body at `linearOffset` and `angularOffset` from this
 * one, with at most `maxForce` and `maxTorque` — something that follows, softly. With
 * `autoConfigureOffset` they are the offsets the two start at.
 */
export class RelativeJoint2D extends Joint2D {
  maxForce = 10000;
  maxTorque = 10000;
  /** How much of the error is closed each step, 0 to 1. */
  correctionScale = 0.3;
  autoConfigureOffset = true;
  /** Where the connected body is held, in this body's space. */
  linearOffset = new Vector2();
  /** Degrees between the two. */
  angularOffset = 0;

  protected make(a: Body, b: Body): Joint {
    if (this.autoConfigureOffset) {
      const local = a.getLocalPoint(b.getPosition());
      this.linearOffset.set(local.x, local.y);
      this.angularOffset = MathUtils.radToDeg(b.getAngle() - a.getAngle());
    }
    return new MotorJoint({ bodyA: a, bodyB: b, collideConnected: this.enableCollision });
  }

  protected override configure(joint: MotorJoint): void {
    joint.setMaxForce(this.maxForce);
    joint.setMaxTorque(this.maxTorque);
    joint.setCorrectionFactor(this.correctionScale);
    joint.setLinearOffset(new Vec2(this.linearOffset.x, this.linearOffset.y));
    joint.setAngularOffset(MathUtils.degToRad(this.angularOffset));
  }
}

/**
 * Unity's `TargetJoint2D`: pulls `anchor` towards `target`, a point in the world, like a spring —
 * dragging a body with the pointer. `connectedBody` is not used. With `autoConfigureTarget` the
 * target starts where the anchor is when the component is added.
 */
export class TargetJoint2D extends Joint2D {
  /** Where it pulls this body, in its node's space. */
  anchor = new Vector2();
  /** Where it pulls to, in the world. */
  target = new Vector2();
  autoConfigureTarget = true;
  maxForce = 1000;
  dampingRatio = 1;
  /** How fast it springs, in hertz. */
  frequency = 5;

  protected override placement(): unknown[] {
    return [this.anchor.x, this.anchor.y];
  }

  // As the component is added, as in Unity — so a target the game sets before the joint is made stands.
  override awake(): void {
    if (!this.autoConfigureTarget) return;
    const world = this.node.localToWorld(new Vector3(this.anchor.x, this.anchor.y, 0));
    this.target.set(world.x, world.y);
  }

  protected make(a: Body): Joint {
    const world = a.getWorldPoint(scaled(this.anchor, this.node.getWorldScale(SCALE)));
    // planck's mouse joint pulls its second body, from where `target` is when it is made.
    return new MouseJoint({ bodyA: service(this.node, Physics2D)._ground(), bodyB: a, target: world, maxForce: this.maxForce, collideConnected: this.enableCollision });
  }

  protected override configure(joint: MouseJoint): void {
    joint.setTarget(new Vec2(this.target.x, this.target.y));
    joint.setMaxForce(this.maxForce);
    joint.setFrequency(this.frequency);
    joint.setDampingRatio(this.dampingRatio);
  }
}

/** planck's friction joint's fields its solve reads. */
interface FrictionState {
  m_bodyA: Body & { c_velocity: { v: Vec2; w: number } };
  m_bodyB: Body & { c_velocity: { v: Vec2; w: number } };
  m_invMassA: number;
  m_invMassB: number;
  m_invIA: number;
  m_invIB: number;
  m_rA: Vec2;
  m_rB: Vec2;
  m_linearMass: Mat22;
  m_angularMass: number;
  m_linearImpulse: Vec2;
  m_angularImpulse: number;
  m_maxForce: number;
  m_maxTorque: number;
}

/**
 * planck 1.5's friction joint takes its old linear impulse as the very `Vec2` it then adds to, so
 * the solve never applies one and the friction comes a step late: a body it stops shakes in place.
 * This is Box2D's solve, which copies it.
 */
class SteadyFrictionJoint extends FrictionJoint {
  override solveVelocityConstraints(step: TimeStep): void {
    const j = this as unknown as FrictionState;
    const a = j.m_bodyA.c_velocity;
    const b = j.m_bodyB.c_velocity;
    const h = step.dt;

    const angular = -j.m_angularMass * (b.w - a.w);
    const oldAngular = j.m_angularImpulse;
    const maxTorque = h * j.m_maxTorque;
    j.m_angularImpulse = Math.min(Math.max(oldAngular + angular, -maxTorque), maxTorque);
    a.w -= j.m_invIA * (j.m_angularImpulse - oldAngular);
    b.w += j.m_invIB * (j.m_angularImpulse - oldAngular);

    const cdot = Vec2.sub(Vec2.add(b.v, Vec2.crossNumVec2(b.w, j.m_rB)), Vec2.add(a.v, Vec2.crossNumVec2(a.w, j.m_rA)));
    const old = Vec2.clone(j.m_linearImpulse);
    j.m_linearImpulse.add(Vec2.neg(Mat22.mulVec2(j.m_linearMass, cdot)));
    const maxForce = h * j.m_maxForce;
    if (j.m_linearImpulse.lengthSquared() > maxForce * maxForce) {
      j.m_linearImpulse.normalize();
      j.m_linearImpulse.mul(maxForce);
    }
    const impulse = Vec2.sub(j.m_linearImpulse, old);
    a.v.subMul(j.m_invMassA, impulse);
    a.w -= j.m_invIA * Vec2.crossVec2Vec2(j.m_rA, impulse);
    b.v.addMul(j.m_invMassB, impulse);
    b.w += j.m_invIB * Vec2.crossVec2Vec2(j.m_rB, impulse);
  }
}

const SCALE = new Vector3();
const SCALE2 = new Vector3();
const ONE = new Vector3(1, 1, 1);

/** A point of a node's own space, scaled into its body's. */
function scaled(point: Vector2, scale: Vector3): Vec2 {
  return new Vec2(point.x * scale.x, point.y * scale.y);
}

function startDistance(a: Body, b: Body, { localAnchorA, localAnchorB }: { localAnchorA: Vec2; localAnchorB: Vec2 }): number {
  const from = a.getWorldPoint(localAnchorA);
  const to = b.getWorldPoint(localAnchorB);
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** A world direction `degrees` from x, in the body's space. */
function axis(body: Body, degrees: number): Vec2 {
  const turn = MathUtils.degToRad(degrees) - body.getAngle();
  return new Vec2(Math.cos(turn), Math.sin(turn));
}
