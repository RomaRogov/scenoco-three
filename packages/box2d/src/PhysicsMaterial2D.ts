/**
 * Unity's `PhysicsMaterial2D`: a surface colliders share through `material={ice}`. As in Unity's 2D
 * physics (Box2D), two touching surfaces' friction combine as the square root of their product, and
 * their bounciness as the larger of the two.
 */
export class PhysicsMaterial2D {
  /** Resistance to sliding: 0 is ice. Unity's default, 0.4. */
  friction = 0.4;
  /** 0 stops dead, 1 bounces back as high. */
  bounciness = 0;

  constructor(init: { friction?: number; bounciness?: number } = {}) {
    if (init.friction !== undefined) this.friction = init.friction;
    if (init.bounciness !== undefined) this.bounciness = init.bounciness;
  }
}
