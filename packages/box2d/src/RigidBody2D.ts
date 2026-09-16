import { Vec2, type Body, type BodyType, type Fixture } from 'planck';
import { Component } from '@scenoco-three/core';
import { Collider2D } from './Collider2D.js';
import { Physics2D } from './Physics2D.js';
import { worldPose } from './transform.js';

// These three modules import one another. That is safe here and worth stating rather than
// working around: an import cycle only bites when a module *evaluates* something from the
// other while it is still initialising, and none of these classes touches another in its
// `extends` clause or a field initializer — the references are all inside methods, which run
// long after every module has finished loading.

/** How a 2D body moves. The value is planck's own body-type name. */
export type RigidBody2DKind = 'dynamic' | 'static' | 'kinematic';

/**
 * Makes this node a 2D physics body. Pair it with one or more colliders on the same node to
 * give it shape.
 *
 * ```xml
 * <Mesh geometry="…" material="…">
 *   <Components>
 *     <RigidBody2D kind="dynamic" bullet="true" />
 *     <CircleCollider2D radius="0.3" restitution="1" />
 *   </Components>
 * </Mesh>
 * ```
 *
 * - `dynamic` — simulated; physics drives the node's x/y and its z rotation
 * - `static` — never moves (walls, ground)
 * - `kinematic` — moved by your code; set `object3D.position` and the body follows, pushing
 *   dynamic bodies out of the way (paddles, moving platforms)
 *
 * The body joins the world in `awake` and leaves it in `onDestroy`, so the physics system never
 * scans for bodies that came or went.
 */
export class RigidBody2D extends Component {
  /** How the body moves. */
  kind: RigidBody2DKind = 'dynamic';
  /** Damps linear velocity over time. */
  linearDamping = 0;
  /** Damps angular velocity over time. */
  angularDamping = 0;
  /** Lock rotation — common for characters. */
  fixedRotation = false;
  /** Multiplier on world gravity for this body alone. */
  gravityScale = 1;
  /** Continuous collision for something fast enough to tunnel through a wall. */
  bullet = false;

  /** The live planck body. Exists from `awake` until `onDestroy`. */
  get body(): Body | null {
    return this._body;
  }

  private _body: Body | null = null;

  /** The physics world this body belongs to. */
  private physics: Physics2D | null = null;
  /** Colliders currently contributing a fixture, so a disable can remove exactly one. */
  private readonly fixtures = new Map<Collider2D, Fixture>();

  // --- lifecycle -------------------------------------------------------------------------

  override awake(): void {
    // `requireSystem` rather than `getSystem`: a scene that never declared `<Physics2D>` still
    // gets a world, with the default gravity. Declaring one only configures it.
    this.physics = this.requireSystem(Physics2D);
    this._body = this.physics.createBody(this);
    // A collider that already started — because the body was added to the node afterwards —
    // has nothing left to attach it. Sweeping the node here closes that direction, so the two
    // may arrive in either order.
    for (const collider of this.object3D.getComponents(Collider2D)) {
      if (collider.isActiveAndEnabled) this.attachCollider(collider);
    }
  }

  /** @internal called by `Physics2D` when its world goes, taking every body with it. */
  releaseBody(): void {
    this._body = null;
  }

  override onEnable(): void {
    // Unity's `Rigidbody2D.simulated`: a disabled body leaves the simulation — its contacts end
    // and its velocities are kept — and rejoins where its node is now, since a script may have
    // moved it in the meantime.
    if (!this.body) return;
    this.body.setActive(true);
    this.syncFromNode();
    this.physics?.resetInterpolation(this);
  }

  override onDisable(): void {
    this.body?.setActive(false);
  }

  override onDestroy(): void {
    this.physics?.destroyBody(this);
    this.fixtures.clear();
    this._body = null;
    this.physics = null;
  }

  // --- colliders -------------------------------------------------------------------------

  /** Give the body a fixture for this collider. Idempotent. */
  attachCollider(collider: Collider2D): void {
    if (!this.body || this.fixtures.has(collider)) return;
    const fixture = this.body.createFixture(collider.toShape(), collider.fixtureOptions());
    fixture.setUserData(collider);
    this.fixtures.set(collider, fixture);
  }

  /**
   * Take this collider's fixture off the body. Idempotent.
   *
   * Toggling a collider is also how a shape change is applied: the fixture is rebuilt from
   * `toShape()` on the way back in, because planck fixtures are immutable once created.
   */
  detachCollider(collider: Collider2D): void {
    const fixture = this.fixtures.get(collider);
    if (!fixture || !this.body) return;
    this.body.destroyFixture(fixture);
    this.fixtures.delete(collider);
  }

  // --- driving it ------------------------------------------------------------------------

  /** Copy the node's XY position and Z rotation onto the body. */
  syncFromNode(): void {
    const { x, y, angle } = worldPose(this.object3D);
    this.body?.setTransform(new Vec2(x, y), angle);
  }

  /** Apply an instantaneous impulse at the body's centre, in world space, waking it. */
  applyImpulse(x: number, y: number): void {
    this.body?.applyLinearImpulse({ x, y }, this.body.getWorldCenter(), true);
  }

  /** Set the linear velocity in world space, waking the body. */
  setVelocity(x: number, y: number): void {
    this.body?.setLinearVelocity({ x, y });
  }

  /** Current linear velocity, or `[0, 0]` before the body exists. */
  getVelocity(): [number, number] {
    const velocity = this.body?.getLinearVelocity();
    return velocity ? [velocity.x, velocity.y] : [0, 0];
  }

  /** Teleport the body, waking it — a respawn or a reset. */
  setPosition(x: number, y: number): void {
    if (!this.body) return;
    this.body.setPosition({ x, y });
    this.body.setAwake(true);
    this.physics?.resetInterpolation(this);
  }

  /** @internal planck's own body-type name, which is what `kind` already holds. */
  bodyType(): BodyType {
    return this.kind;
  }
}
