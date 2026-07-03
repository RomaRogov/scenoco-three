import type { Object3D } from 'three';
import { Component, component, property } from '@scenoco-three/core';
import { RigidBody2D } from '@scenoco-three/box2d';
import { Brick } from './Brick.js';
import { Scoreboard } from './Scoreboard.js';

/**
 * The Breakout ball — driven by Box2D (planck) physics. It shows off two array
 * properties:
 *
 *   • `bounceSpeeds` — a `['float']` array of three candidate speeds. On *every*
 *     bounce the ball re-rolls its speed to one of them at random, so the rally
 *     keeps changing pace.
 *   • `bricks` — a `[Brick]` array of typed component references. The bricks are
 *     placed individually in the scene as `<PrefabInstance>`s and handed to the
 *     ball as `bricks="[#b1,#b2,…]"`. When Box2D reports a contact with one of
 *     them, the ball logs the hit and removes the brick.
 *
 * Collision detection is entirely Box2D's: the ball has a dynamic `<RigidBody2D>`
 * (a `<CircleCollider2D>` with restitution 1), and `onCollisionEnter2D` is the
 * duck-typed hook the `Physics2DSystem` calls on contact.
 */
@component({
  name: 'Ball',
  description: 'Box2D breakout ball: launches, re-rolls its speed on every bounce, destroys bricks on contact',
})
export class Ball extends Component {
  /** Candidate speeds — one is chosen at random on every bounce. */
  @property({ type: ['float'], default: [8, 12, 16], description: 'Bounce speeds; one is picked at random per bounce' })
  bounceSpeeds: number[] = [8, 12, 16];

  /** The brick instances placed in the scene, referenced as an array. */
  @property({ type: [Brick], description: 'Brick instances the ball can break' })
  bricks: Brick[] = [];

  @property({ type: 'float', default: 12, description: 'Speed the ball is launched at' })
  launchSpeed = 12;

  /** The paddle node — the ball resets above it after a miss. */
  @property({ type: 'node', description: 'Paddle node (the ball resets above it)' })
  paddle: Object3D | null = null;

  /** The bottom trigger node — entering it costs a life. */
  @property({ type: 'node', description: 'Bottom sensor node (entering it loses the ball)' })
  bottom: Object3D | null = null;

  /** The HUD controller — updated as score/lives change (drives the DOM overlay). */
  @property({ type: Scoreboard, description: 'HUD readout to update on score/lives changes' })
  scoreboard: Scoreboard | null = null;

  @property({ type: 'int', default: 3, description: 'Starting lives' })
  lives = 3;

  private remaining = 0;
  private over = false;
  private body: RigidBody2D | null = null;

  override onLoad(): void {
    this.body = this.getComponent(RigidBody2D);
    this.remaining = this.bricks.length;
    this.scoreboard?.setLives(this.lives);
    console.log(`[Breakout] ${this.remaining} bricks in play — press SPACE to launch.`);
  }

  override update(): void {
    // Launch on the frame SPACE is pressed (engine.input handles the DOM + edge).
    if (this.engine.input.getKeyDown('Space')) this.launch();
  }

  /** Send the ball upward at `launchSpeed`, with a small random horizontal spread. */
  launch(): void {
    if (this.over) return;
    const angle = Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
    this.body?.setVelocity(Math.cos(angle) * this.launchSpeed, Math.sin(angle) * this.launchSpeed);
  }

  /** Box2D contact hook: re-roll the speed, and destroy a brick if that's what we hit. */
  onCollisionEnter2D(other: Object3D): void {
    this.rerollSpeed();
    const brick = this.bricks.find((b) => !b.destroyed && b.node === other);
    if (brick) this.destroyBrick(brick);
  }

  /** Box2D sensor hook: entering the bottom trigger means the ball was missed. */
  onTriggerEnter2D(other: Object3D): void {
    if (other !== this.bottom || this.over) return;
    this.lives--;
    this.scoreboard?.setLives(this.lives);
    if (this.lives <= 0) {
      this.over = true;
      this.body?.setVelocity(0, 0);
      this.scoreboard?.banner('GAME OVER');
      console.log('[Breakout] GAME OVER.');
      return;
    }
    console.log(`[Breakout] Ball lost — ${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left.`);
    this.resetToPaddle();
  }

  /** Park the ball above the paddle, stopped, ready for the next SPACE launch. */
  resetToPaddle(): void {
    this.body?.setVelocity(0, 0);
    this.body?.setPosition(this.paddle?.position.x ?? 0, (this.paddle?.position.y ?? 0.5) + 0.6);
  }

  /** Keep the current heading, but set the *magnitude* to a random one of `bounceSpeeds`. */
  private rerollSpeed(): void {
    if (!this.body || this.bounceSpeeds.length === 0) return;
    const speed = this.bounceSpeeds[Math.floor(Math.random() * this.bounceSpeeds.length)]!;
    const [vx, vy] = this.body.getVelocity();
    const mag = Math.hypot(vx, vy) || 1;
    this.body.setVelocity((vx / mag) * speed, (vy / mag) * speed);
    console.log(`[Breakout] bounce → speed ${speed}`);
  }

  private destroyBrick(brick: Brick): void {
    brick.destroyed = true;
    this.remaining--;
    this.scoreboard?.addPoints(brick.points);
    console.log(`[Breakout] Brick hit! +${brick.points} points — ${this.remaining} brick(s) left.`);
    this.engine.destroy(brick.node);
    if (this.remaining === 0) {
      this.scoreboard?.banner('YOU WIN!');
      console.log('[Breakout] YOU WIN! All bricks cleared.');
    }
  }
}
