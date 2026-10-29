import { Vector2, type Object3D } from 'three';
import { Behaviour, destroy } from '@scenoco-three/core';
import { Rigidbody2D, type Collider2D } from '@scenoco-three/box2d';
import type { Bonus } from './bonus.js';
import { Paddle } from './Paddle.js';

/**
 * A bonus falling from a broken brick. The paddle catches it by touching it — a trigger, so it
 * falls through everything else — and one that reaches the floor is gone.
 */
export class Pickup extends Behaviour<Object3D> {
  bonus: Exclude<Bonus, 'none'> = 'wide';
  /** Units per second, straight down. */
  fallSpeed = 4.5;

  override start(): void {
    this.node.getComponent(Rigidbody2D)!.linearVelocity = new Vector2(0, -this.fallSpeed);
  }

  override update(): void {
    if (this.node.position.y < -2) destroy(this.node);
  }

  override onTriggerEnter2D(other: Collider2D): void {
    const paddle = other.node.getComponent(Paddle);
    if (!paddle) return;
    paddle.catch(this.bonus);
    destroy(this.node);
  }
}
