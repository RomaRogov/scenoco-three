import type { Body } from 'planck';
import { Component, component, property } from '@scenoco-three/core';

/**
 * Marks the host node as a Box2D (planck) 2D rigid body — plain data the
 * `Physics2DSystem` reconciles into the world. Pair it with one or more
 * `<Collider2D>` on the same node to give it shape. The system stamps the live
 * planck `body` onto this component once built.
 *
 *   dynamic   — simulated; physics drives the node's x/y and rotation.z
 *   static    — never moves (walls, ground)
 *   kinematic — moved by your code (set node.position); the body follows it,
 *               pushing dynamic bodies (paddles, moving platforms)
 */
@component({ name: 'RigidBody2D', description: 'A 2D physics body (planck/Box2D); pair with <Collider2D>. Needs a <Physics2D> scene.' })
export class RigidBody2D extends Component {
  @property({ type: 'string', default: 'dynamic', description: 'dynamic | static | kinematic' })
  kind = 'dynamic';

  @property({ type: 'float', default: 0 }) linearDamping = 0;
  @property({ type: 'float', default: 0 }) angularDamping = 0;

  @property({ type: 'bool', default: false, description: 'Lock rotation (common for characters)' })
  fixedRotation = false;

  @property({ type: 'float', default: 1, description: 'Multiplier on world gravity for this body' })
  gravityScale = 1;

  @property({ type: 'bool', default: false, description: 'Continuous collision for fast bodies (e.g. a ball)' })
  bullet = false;

  /** The live planck body, set by the Physics2DSystem after it builds it. */
  body?: Body;

  /** Apply an instantaneous impulse at the body's center (world space), waking it. */
  applyImpulse(x: number, y: number): void {
    if (this.body) this.body.applyLinearImpulse({ x, y }, this.body.getWorldCenter(), true);
  }

  /** Set the linear velocity (world space), waking the body. */
  setVelocity(x: number, y: number): void {
    this.body?.setLinearVelocity({ x, y });
  }

  /** Current linear velocity, or `[0, 0]` before the body exists. */
  getVelocity(): [number, number] {
    const v = this.body?.getLinearVelocity();
    return v ? [v.x, v.y] : [0, 0];
  }
}
