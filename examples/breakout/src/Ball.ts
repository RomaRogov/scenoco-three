import { Vector2, type Object3D } from 'three';
import { Behaviour, Input, KeyCode, MouseButton, findObjectOfType, instantiate, type Prefab } from '@scenoco-three/core';
import { Rigidbody2D, type Collider2D, type Collision2D } from '@scenoco-three/box2d';
import { Brick } from './Brick.js';
import { Floor } from './Floor.js';
import { GameState } from './GameState.js';
import { Paddle } from './Paddle.js';

/**
 * The ball: rests on the paddle, launches, and never changes pace.
 *
 * Box2D does the bouncing — every surface here has bounciness 1 — but a physics ball is not a
 * Breakout ball. Two rules are enforced on top of it every step: the speed is held constant, so
 * a glancing hit cannot bleed the rally to a crawl, and the angle is kept away from horizontal,
 * because a ball travelling sideways between two walls never comes back.
 *
 * A multi-ball is more of this prefab: `split` instantiates `copy` twice beside it, each sent off at
 * an angle from this one's path.
 */
export class Ball extends Behaviour<Object3D> {
  /** How high above the paddle it waits. */
  restHeight = 0.62;
  /** How far the paddle can steer a bounce, in degrees from straight up: Breakout's one skill. */
  steer = 62;
  /** What `split` makes more of: this ball's own prefab. */
  copy: Prefab | null = null;

  /** Set on a copy before its `start`: the direction it leaves in, radians from straight up. */
  heading: number | null = null;

  private body!: Rigidbody2D;
  private game!: GameState;
  private paddle!: Paddle;

  override awake(): void {
    this.body = this.node.getComponent(Rigidbody2D)!;
    this.game = findObjectOfType(GameState)!;
    this.paddle = findObjectOfType(Paddle)!;
    this.game.addBall(this);
    this.listen(this.game.ballReset, this.follow);
  }

  override start(): void {
    if (this.heading === null) this.follow();
    else this.send(this.heading);
  }

  override onDestroy(): void {
    this.game.removeBall(this);
  }

  override update(): void {
    if (this.game.phase === 'playing') return;
    this.follow();
    if (this.game.phase !== 'ready') return;
    if (Input.getMouseButtonDown(MouseButton.Left) || Input.getKeyDown(KeyCode.Space)) {
      // Always upward, leaning the way the paddle is off-centre, so the first shot is the player's.
      this.send(Math.atan(this.paddle.node.position.x / 16));
      this.game.launched();
    }
  }

  override fixedUpdate(): void {
    if (this.game.phase === 'playing') this.hold();
  }

  /** Two more of this ball, fanned out from its path. */
  split(): void {
    if (!this.copy) return;
    const { x, y } = this.body.linearVelocity;
    const along = Math.atan2(x, y);
    for (const turn of [-0.45, 0.45]) {
      const ball = instantiate(this.copy, { position: this.node.position.clone() });
      // In by its `start`, which is where it reads it — Unity's order after `Instantiate`.
      ball.getComponent(Ball)!.heading = along + turn;
    }
  }

  // --- the two rules --------------------------------------------------------------------

  /** Keep the speed constant and the path off the horizontal. */
  private hold(): void {
    const { x, y } = this.body.linearVelocity;
    const length = Math.hypot(x, y);
    if (length < 1e-4) return this.send(0);
    let dirX = x / length;
    let dirY = y / length;
    // Below about 12° from flat, a rally can bounce between the side walls for ever: bend it back.
    const MIN_VERTICAL = 0.21;
    if (Math.abs(dirY) < MIN_VERTICAL) {
      dirY = dirY === 0 ? MIN_VERTICAL : Math.sign(dirY) * MIN_VERTICAL;
      const renormalise = Math.hypot(dirX, dirY);
      dirX /= renormalise;
      dirY /= renormalise;
    }
    this.body.linearVelocity = new Vector2(dirX * this.speed, dirY * this.speed);
  }

  /** The level's pace: `GameState.ballSpeed`. */
  private get speed(): number {
    return this.game.ballSpeed;
  }

  private send(angle: number): void {
    this.body.linearVelocity = new Vector2(Math.sin(angle) * this.speed, Math.cos(angle) * this.speed);
  }

  private readonly follow = (): void => {
    const at = this.paddle.node.position;
    this.node.position.set(at.x, at.y + this.restHeight, 0);
    this.body.position = new Vector2(at.x, at.y + this.restHeight);
    this.body.linearVelocity = new Vector2(0, 0);
  };

  // --- what it runs into ----------------------------------------------------------------

  override onCollisionEnter2D(collision: Collision2D): void {
    const other = collision.node;
    if (other === this.paddle.node) return this.offPaddle();
    const brick = other.getComponent(Brick);
    if (brick) brick.hit();
    else this.game.sfx?.play('wall');
  }

  override onTriggerEnter2D(other: Collider2D): void {
    if (other.node.getComponent(Floor)) this.game.lost(this);
  }

  /** Leave the paddle at an angle set by where it was hit: the edges throw it wide. */
  private offPaddle(): void {
    const half = 1.6 * this.paddle.node.scale.x;
    const offset = Math.max(-1, Math.min(1, (this.node.position.x - this.paddle.node.position.x) / half));
    this.send((offset * this.steer * Math.PI) / 180);
    this.paddle.struck();
    this.game.returned();
    this.game.sfx?.play('paddle');
  }
}
