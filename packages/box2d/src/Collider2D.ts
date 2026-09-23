import type { FixtureOpt, Shape } from 'planck';
import { Component } from '@scenoco-three/core';
import { RigidBody2D } from './RigidBody2D.js';

/**
 * Shared base for the 2D collision shapes; `<BoxCollider2D>`, `<CircleCollider2D>` and the rest
 * subclass it and implement `toShape()`.
 *
 * Mirrors how each light is its own tag.
 *
 * A collider attaches to the `<RigidBody2D>` **on its own node**, and does so itself. There is
 * no registry and no per-step reconcile: the body is asked for in `start`, which is exactly
 * when every component in the scene has woken, so the two may be written in either order.
 *
 * Abstract, so it is machinery rather than a tag a document can write.
 */
export abstract class Collider2D extends Component {
  /** Density in kg/m². Zero for a shape that should not contribute mass. */
  density = 1;
  /** Friction, 0..1. */
  friction = 0.3;
  /** Restitution — bounciness, 0..1. */
  restitution = 0;
  /** A trigger: reports overlaps and produces no collision response. */
  isSensor = false;

  /** The planck shape for this collider. */
  abstract toShape(): Shape;

  /** Fixture material and flags, as `body.createFixture` wants them. */
  fixtureOptions(): FixtureOpt {
    return {
      density: this.density,
      friction: this.friction,
      restitution: this.restitution,
      isSensor: this.isSensor,
    };
  }

  // --- attachment ------------------------------------------------------------------------
  //
  // `start` rather than `awake`: the body may be declared after the collider on the same node,
  // and by `start` every `awake` in the scene has run. `onEnable` tries too, for a collider
  // enabled later; both paths are idempotent, so whichever arrives first wins and the other is
  // a no-op. That is the whole registration — no system-side polling of anything.

  override start(): void {
    this.body()?.attachCollider(this);
  }

  override onEnable(): void {
    this.body()?.attachCollider(this);
  }

  override onDisable(): void {
    this.body()?.detachCollider(this);
  }

  override onDestroy(): void {
    this.body()?.detachCollider(this);
  }

  /**
   * Re-apply this collider's shape and material to the body.
   *
   * A planck fixture is immutable once created, so changing `radius`, `halfExtents`,
   * `isSensor` or the material at runtime does **not** reach the simulation on its own. Call
   * this after such a change:
   *
   * ```ts
   * collider.radius = 2;
   * collider.rebuild();
   * ```
   *
   * Nothing needs it at load time: the values a document authors are applied before `awake`, so
   * the first fixture is already built from them.
   */
  rebuild(): void {
    const body = this.body();
    if (!body) return;
    body.detachCollider(this);
    if (this.isActiveAndEnabled) body.attachCollider(this);
  }

  /** The body this collider gives shape to, or null while the node has none. */
  protected body(): RigidBody2D | null {
    return this.getComponent(RigidBody2D);
  }
}
