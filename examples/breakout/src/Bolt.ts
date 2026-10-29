import { Vector2, Vector3, type Object3D } from 'three';
import { Behaviour, destroy, instantiate, type Prefab } from '@scenoco-three/core';
import { Rigidbody2D, type Collider2D } from '@scenoco-three/box2d';
import { Brick } from './Brick.js';
import { Paddle } from './Paddle.js';

/** A laser bolt from the paddle's cannons: straight up, into the first brick or wall it meets. */
export class Bolt extends Behaviour<Object3D> {
  speed = 26;
  /** The flash where it strikes. */
  spark: Prefab | null = null;

  override start(): void {
    this.node.getComponent(Rigidbody2D)!.linearVelocity = new Vector2(0, this.speed);
  }

  override update(): void {
    if (this.node.position.y > 18) destroy(this.node);
  }

  override onTriggerEnter2D(other: Collider2D): void {
    // It is born inside the paddle's reach: the paddle is not a target.
    if (other.node.getComponent(Paddle)) return;
    other.node.getComponent(Brick)?.hit();
    if (this.spark) instantiate(this.spark, { position: this.node.getWorldPosition(new Vector3()) });
    destroy(this.node);
  }
}
