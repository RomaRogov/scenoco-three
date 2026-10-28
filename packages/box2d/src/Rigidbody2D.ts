import { Vec2, type Body } from 'planck';
import { MathUtils, Vector2 } from 'three';
import { Behaviour, service } from '@scenoco-three/core';
import { Collider2D } from './Collider2D.js';
import { Physics2D } from './Physics2D.js';
import { worldPose } from './transform.js';

/** How a 2D body moves — Unity's `RigidbodyType2D`. */
export const RigidbodyType2D = {
  /** Moved by forces, gravity and what it hits. */
  Dynamic: 0,
  /** Moved by the game — its node, or `movePosition` — and pushes dynamic bodies out of the way. */
  Kinematic: 1,
  /** Never moves: walls, ground. A collider with no Rigidbody2D is static too. */
  Static: 2,
} as const;
export type RigidbodyType2D = (typeof RigidbodyType2D)[keyof typeof RigidbodyType2D];

/** What a body may not do — Unity's `RigidbodyConstraints2D`, combined with `|`. */
export const RigidbodyConstraints2D = {
  None: 0,
  FreezePositionX: 1,
  FreezePositionY: 2,
  FreezeRotation: 4,
  FreezePosition: 3,
  FreezeAll: 7,
} as const;
/** One of `RigidbodyConstraints2D`, or several combined with `|`. */
export type RigidbodyConstraints2D = number;

/** How `addForce` and `addTorque` apply — Unity's `ForceMode2D`. */
export const ForceMode2D = {
  /** Newtons, over one fixed step: mass matters. The default. */
  Force: 0,
  /** Newton-seconds, at once: a jump, a hit. */
  Impulse: 1,
} as const;
export type ForceMode2D = (typeof ForceMode2D)[keyof typeof ForceMode2D];

/** Whether a fast body is checked between steps, so it cannot pass through a thin wall — Unity's `CollisionDetectionMode2D`. */
export const CollisionDetectionMode2D = {
  Discrete: 0,
  Continuous: 1,
} as const;
export type CollisionDetectionMode2D = (typeof CollisionDetectionMode2D)[keyof typeof CollisionDetectionMode2D];

/**
 * Unity's `Rigidbody2D`: makes its node a body in the XY plane — it drives the node's x, y and
 * `rotation.z`, and leaves z for depth. Its shape is the colliders on its node and on nodes under it.
 * Angles are degrees, as in Unity's 2D physics. A change to any setting applies at once.
 *
 * A dynamic body moves its node — set its velocity or add force, not `node.position`. A kinematic
 * one follows its node, or `movePosition`, pushing what is in its way; a static one stays put.
 */
export class Rigidbody2D extends Behaviour {
  /** @internal */ _body: Body | null = null;
  /** @internal */ _physics: Physics2D | null = null;
  /** @internal where `movePosition` and `moveRotation` asked to be at the end of the next step. */ _target: { x: number; y: number; angle: number } | null = null;

  private _bodyType: RigidbodyType2D = RigidbodyType2D.Dynamic;
  private _mass = 1;
  private _useAutoMass = false;
  private _gravityScale = 1;
  private _linearDamping = 0;
  private _angularDamping = 0.05;
  private _constraints: RigidbodyConstraints2D = RigidbodyConstraints2D.None;
  private _collisionDetectionMode: CollisionDetectionMode2D = CollisionDetectionMode2D.Discrete;

  /** How the body moves. */
  get bodyType(): RigidbodyType2D {
    return this._bodyType;
  }
  set bodyType(value: RigidbodyType2D) {
    this._bodyType = value;
    this._body?.setType(BODY_TYPES[value]);
    this._refreshMass();
  }

  /** Kilograms. Unity's default: 1, whatever the colliders' size — unless `useAutoMass`. */
  get mass(): number {
    return this._useAutoMass && this._body ? this._body.getMass() : this._mass;
  }
  set mass(value: number) {
    this._mass = value;
    this._refreshMass();
  }

  /** The mass from the colliders' area and `density`, instead of `mass`. */
  get useAutoMass(): boolean {
    return this._useAutoMass;
  }
  set useAutoMass(value: boolean) {
    this._useAutoMass = value;
    this._refreshMass();
  }

  /** How much `Physics2D.gravity` pulls this body: 0 floats. */
  get gravityScale(): number {
    return this._gravityScale;
  }
  set gravityScale(value: number) {
    this._gravityScale = value;
    this._body?.setGravityScale(value);
  }

  /** Slows the body's movement over time — Unity's `linearDamping` (formerly `drag`). */
  get linearDamping(): number {
    return this._linearDamping;
  }
  set linearDamping(value: number) {
    this._linearDamping = value;
    this._body?.setLinearDamping(value);
  }

  /** Slows the body's turning over time — Unity's `angularDamping`, 0.05 by default. */
  get angularDamping(): number {
    return this._angularDamping;
  }
  set angularDamping(value: number) {
    this._angularDamping = value;
    this._body?.setAngularDamping(value);
  }

  /** What it may not do: `RigidbodyConstraints2D.FreezeRotation | RigidbodyConstraints2D.FreezePositionX`. */
  get constraints(): RigidbodyConstraints2D {
    return this._constraints;
  }
  set constraints(value: RigidbodyConstraints2D) {
    this._constraints = value;
    if (!this._body) return;
    this._body.setFixedRotation((value & RigidbodyConstraints2D.FreezeRotation) !== 0);
    this._refreshMass();
  }

  /** Whether it may turn — `constraints`' `FreezeRotation` on its own. */
  get freezeRotation(): boolean {
    return (this._constraints & RigidbodyConstraints2D.FreezeRotation) !== 0;
  }
  set freezeRotation(value: boolean) {
    this.constraints = value ? this._constraints | RigidbodyConstraints2D.FreezeRotation : this._constraints & ~RigidbodyConstraints2D.FreezeRotation;
  }

  /** `Continuous` for something fast enough to pass through a wall in one step: a bullet, a ball. */
  get collisionDetectionMode(): CollisionDetectionMode2D {
    return this._collisionDetectionMode;
  }
  set collisionDetectionMode(value: CollisionDetectionMode2D) {
    this._collisionDetectionMode = value;
    this._body?.setBullet(value === CollisionDetectionMode2D.Continuous);
  }

  /** Metres per second, in world space. Set it to move the body that way from now on. */
  get linearVelocity(): Vector2 {
    const v = this._body?.getLinearVelocity();
    return new Vector2(v?.x ?? 0, v?.y ?? 0);
  }
  set linearVelocity(value: Vector2) {
    this._body?.setLinearVelocity(new Vec2(this.frozen(RigidbodyConstraints2D.FreezePositionX) ? 0 : value.x, this.frozen(RigidbodyConstraints2D.FreezePositionY) ? 0 : value.y));
    this._body?.setAwake(true);
  }

  /** Degrees per second, counter-clockwise. */
  get angularVelocity(): number {
    return MathUtils.radToDeg(this._body?.getAngularVelocity() ?? 0);
  }
  set angularVelocity(value: number) {
    if (this.freezeRotation) return;
    this._body?.setAngularVelocity(MathUtils.degToRad(value));
    this._body?.setAwake(true);
  }

  /** Where the body is in the world. Set, it teleports there — a respawn. */
  get position(): Vector2 {
    const p = this._body?.getPosition() ?? worldPose(this.node);
    return new Vector2(p.x, p.y);
  }
  set position(value: Vector2) {
    if (!this._body) return;
    this._body.setPosition(new Vec2(value.x, value.y));
    this._body.setAwake(true);
    this._physics?.resetInterpolation(this);
  }

  /** Its turn in the world, in degrees counter-clockwise. Set, it turns there at once. */
  get rotation(): number {
    return MathUtils.radToDeg(this._body?.getAngle() ?? worldPose(this.node).angle);
  }
  set rotation(value: number) {
    if (!this._body) return;
    this._body.setAngle(MathUtils.degToRad(value));
    this._body.setAwake(true);
    this._physics?.resetInterpolation(this);
  }

  /** The planck body, from `awake` to `onDestroy` — for planck's own API, where Unity's does not reach. */
  get planckBody(): Body | null {
    return this._body;
  }

  /** Push it — Unity's `AddForce`: `ForceMode2D.Force` over this step, or `Impulse` at once. */
  addForce(force: Vector2, mode: ForceMode2D = ForceMode2D.Force): void {
    const body = this._body;
    if (!body) return;
    const f = new Vec2(force.x, force.y);
    if (mode === ForceMode2D.Impulse) body.applyLinearImpulse(f, body.getWorldCenter(), true);
    else body.applyForce(f, body.getWorldCenter(), true);
  }

  /** Push it at a point in the world — off its centre, it turns too. */
  addForceAtPosition(force: Vector2, position: Vector2, mode: ForceMode2D = ForceMode2D.Force): void {
    const body = this._body;
    if (!body) return;
    const f = new Vec2(force.x, force.y);
    const at = new Vec2(position.x, position.y);
    if (mode === ForceMode2D.Impulse) body.applyLinearImpulse(f, at, true);
    else body.applyForce(f, at, true);
  }

  /** Turn it, counter-clockwise for a positive torque. */
  addTorque(torque: number, mode: ForceMode2D = ForceMode2D.Force): void {
    if (mode === ForceMode2D.Impulse) this._body?.applyAngularImpulse(torque, true);
    else this._body?.applyTorque(torque, true);
  }

  /**
   * Move it to `position` over the next step — Unity's `MovePosition`: a kinematic body pushes what
   * is in the way, as if it had travelled there.
   */
  movePosition(position: Vector2): void {
    const pose = this._target ?? this.pose();
    this._target = { ...pose, x: position.x, y: position.y };
  }

  /** Turn it to `angle` degrees over the next step — Unity's `MoveRotation`. */
  moveRotation(angle: number): void {
    const pose = this._target ?? this.pose();
    this._target = { ...pose, angle: MathUtils.degToRad(angle) };
  }

  isAwake(): boolean {
    return this._body?.isAwake() ?? false;
  }

  isSleeping(): boolean {
    return !this.isAwake();
  }

  sleep(): void {
    this._body?.setAwake(false);
  }

  wakeUp(): void {
    this._body?.setAwake(true);
  }

  // --- lifecycle -------------------------------------------------------------------------

  override awake(): void {
    this._physics = service(this.node, Physics2D);
    this._body = this._physics.createBody(this);
    this.constraints = this._constraints;
    // Colliders that started before this body existed — on its node or under it — join it now; one
    // that was static until now leaves its own body.
    for (const collider of this.getComponentsInChildren(Collider2D)) {
      if (!collider._started || !collider.enabled || collider.attachedRigidbody !== this) continue;
      collider._remove();
      collider._add();
    }
    this._refreshMass();
  }

  override onEnable(): void {
    // Unity's `simulated`: a disabled body leaves the simulation and comes back where its node is now.
    if (!this._body) return;
    this._body.setActive(true);
    const { x, y, angle } = worldPose(this.node);
    this._body.setTransform(new Vec2(x, y), angle);
    this._physics?.resetInterpolation(this);
  }

  override onDisable(): void {
    this._body?.setActive(false);
  }

  override onDestroy(): void {
    const colliders = this._body ? [...this._physics!.collidersOn(this._body)] : [];
    this._physics?.destroyBody(this);
    this._body = null;
    // As in Unity, its colliders stay, static now.
    for (const collider of colliders) {
      collider._body = null;
      collider._fixtures = [];
      if (!collider.isDestroyed && !collider._pendingDestroy) collider._add();
    }
  }

  /** @internal the mass Unity gives it: `mass` spread as the colliders spread it, or theirs with `useAutoMass`. */
  _refreshMass(): void {
    const body = this._body;
    if (!body) return;
    body.resetMassData();
    if (this._useAutoMass || this._bodyType !== RigidbodyType2D.Dynamic) return;
    const data = { mass: 0, center: new Vec2(), I: 0 };
    body.getMassData(data);
    const scale = data.mass > 0 ? this._mass / data.mass : 1;
    // planck's inertia is about the body's origin: the part from the centre's offset scales with it too.
    body.setMassData({ mass: this._mass, center: data.center, I: data.I * scale });
  }

  /** @internal whether this axis is frozen. */
  frozen(flag: number): boolean {
    return (this._constraints & flag) !== 0;
  }

  private pose(): { x: number; y: number; angle: number } {
    const p = this._body?.getPosition();
    return p ? { x: p.x, y: p.y, angle: this._body!.getAngle() } : worldPose(this.node);
  }
}

const BODY_TYPES = ['dynamic', 'kinematic', 'static'] as const;
