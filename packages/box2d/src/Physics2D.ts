import { Attachment, attachment, property, ValueType } from '@scenoco-three/core';

/**
 * Scene-level 2D physics config: `<Physics2D gravity="0 -9.81" />` inside `<Scene>`.
 *
 * A pure config attachment — the `Physics2DSystem` (auto-run while the scene has
 * 2D bodies) reads `gravity` and the solver iteration counts via
 * `engine.findAttachment(Physics2D)`. The simulation runs in the XY plane: a
 * body's position drives the node's `x`/`y` and its angle drives `rotation.z`.
 *
 * Unlike the Rapier add-on, no async init is needed — planck (Box2D) is pure JS.
 */
@attachment({ name: 'Physics2D', target: 'Scene', group: 'physics2d', description: 'Scene 2D physics config (gravity, solver iterations)' })
export class Physics2D extends Attachment {
  @property({ type: ValueType.Vec2, description: 'Gravity vector (XY plane)' })
  gravity = [0, -9.81];

  @property({ type: ValueType.Int, description: 'Velocity solver iterations per step' })
  velocityIterations = 8;

  @property({ type: ValueType.Int, description: 'Position solver iterations per step' })
  positionIterations = 3;

  // Config only: the values are read by Physics2DSystem; nothing to apply here.
  attach(): void {}
}
