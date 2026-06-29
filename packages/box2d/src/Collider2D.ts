import type { FixtureOpt, Shape } from 'planck';
import { Component, property } from '@scenoco-three/core';

/**
 * Shared base for the 2D collision shapes (planck), mirroring how each light is
 * its own tag: the concrete shapes — `<BoxCollider2D>`, `<CircleCollider2D>`,
 * `<EdgeCollider2D>`, `<PolygonCollider2D>`, `<ChainCollider2D>` — subclass this
 * and implement `toShape()`. The `Physics2DSystem` attaches every `Collider2D` on
 * a node to that node's `<RigidBody2D>` (no manual registration).
 *
 * This base is **abstract** and registers no tag of its own; it only carries the
 * shared fixture material/sensor properties.
 */
export abstract class Collider2D extends Component {
  @property({ type: 'float', default: 1, description: 'Density (kg/m²); 0 for static' })
  density = 1;

  @property({ type: 'float', default: 0.3, description: 'Friction 0..1' })
  friction = 0.3;

  @property({ type: 'float', default: 0, description: 'Restitution (bounciness) 0..1' })
  restitution = 0;

  @property({ type: 'bool', default: false, description: 'A trigger: reports overlaps, no collision response' })
  isSensor = false;

  /** The planck shape for this collider. */
  abstract toShape(): Shape;

  /** Fixture material/flags for `body.createFixture(shape, opt)`. */
  fixtureOpt(): FixtureOpt {
    return {
      density: this.density,
      friction: this.friction,
      restitution: this.restitution,
      isSensor: this.isSensor,
    };
  }
}
