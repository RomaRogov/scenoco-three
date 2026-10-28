import { Vector2, type Mesh, type Object3D } from 'three';
import { Behaviour, Input, KeyCode, MouseButton, findObjectOfType } from '@scenoco-three/core';
import { Rigidbody2D, type Collision2D } from '@scenoco-three/box2d';
import { Brick } from './Brick.js';
import { GameState } from './GameState.js';

/**
 * The ball: rests on the paddle, launches, and never changes pace.
 *
 * Box2D does the bouncing — every surface here has bounciness 1 — but a physics ball is not a
 * Breakout ball. Two rules are enforced on top of it every step: the speed is held constant, so
 * a glancing hit cannot bleed the rally to a crawl, and the angle is kept away from horizontal,
 * because a ball travelling sideways between two walls never comes back and the game is over
 * without ending.
 */
export class Ball extends Behaviour<Mesh> {
  /** The node the ball sits on while waiting, and steers off. */
  paddle!: Object3D;

  /** How high above the paddle it waits. */
  restHeight = 0.62;

  /**
   * How far the bounce angle can be steered by where the paddle was struck, in degrees from
   * straight up. Classic Breakout's one piece of skill.
   */
  steer = 62;

  /**
   * How fast the ball travels, in units per second — constant, whatever it bounces off.
   *
   * It belongs to the ball, so it lives on the ball — even though the ball is inside the arena
   * every level shares. A level that wants it faster passes `<Arena ballSpeed={18} />`.
   */
  speed = 15;

  private body!: Rigidbody2D;
  private game!: GameState;

  override awake(): void {
    this.body = this.node.getComponent(Rigidbody2D)!;
    this.game = findObjectOfType(GameState)!;
    this.listen(this.game.ballReset, this.rest);
  }

  override start(): void {
    this.rest();
  }

  override update(): void {
    if (this.game.phase === 'ready') {
      this.follow();
      if (Input.getMouseButtonDown(MouseButton.Left) || Input.getKeyDown(KeyCode.Space)) this.launch();
      return;
    }
    if (this.game.phase !== 'playing') this.follow();
  }

  override fixedUpdate(): void {
    if (this.game.phase !== 'playing') return;
    this.hold();
  }

  // --- the two rules --------------------------------------------------------------------

  /** Keep the speed constant and the path off the horizontal. */
  private hold(): void {
    const { x, y } = this.body.linearVelocity;
    const length = Math.hypot(x, y);
    if (length < 1e-4) return this.launch();

    let dirX = x / length;
    let dirY = y / length;
    // Below about 12° from flat, a rally can bounce between the side walls for ever. Push the
    // vertical component back up and renormalise, which bends the path rather than stopping it.
    const MIN_VERTICAL = 0.21;
    if (Math.abs(dirY) < MIN_VERTICAL) {
      dirY = dirY === 0 ? MIN_VERTICAL : Math.sign(dirY) * MIN_VERTICAL;
      const renormalise = Math.hypot(dirX, dirY);
      dirX /= renormalise;
      dirY /= renormalise;
    }
    this.body.linearVelocity = new Vector2(dirX * this.speed, dirY * this.speed);
  }

  private follow(): void {
    this.node.position.set(this.paddle.position.x, this.paddle.position.y + this.restHeight, 0);
    this.body.position = new Vector2(this.node.position.x, this.node.position.y);
    this.body.linearVelocity = new Vector2(0, 0);
  }

  private launch(): void {
    // Always upward, leaning the way the paddle is off-centre, so the first shot is the
    // player's rather than the same shot every time.
    const lean = (this.paddle.position.x / 8) * 0.5;
    const angle = Math.atan(lean);
    this.body.linearVelocity = new Vector2(Math.sin(angle) * this.speed, Math.cos(angle) * this.speed);
    this.game.launched();
  }

  private readonly rest = (): void => {
    this.follow();
  };

  // --- what it runs into ----------------------------------------------------------------

  override onCollisionEnter2D(collision: Collision2D): void {
    const other = collision.node;
    if (other === this.paddle) return this.steerOffPaddle();
    const brick = other.getComponent(Brick);
    if (brick) brick.hit();
  }

  override onTriggerEnter2D(): void {
    // The only sensor in the level is the floor.
    this.game.missed();
  }

  /**
   * Leave the paddle at an angle set by where it was hit — the edges throw the ball wide, the
   * middle sends it back up.
   */
  private steerOffPaddle(): void {
    const offset = clamp((this.node.position.x - this.paddle.position.x) / 1.7, -1, 1);
    const angle = (offset * this.steer * Math.PI) / 180;
    this.body.linearVelocity = new Vector2(Math.sin(angle) * this.speed, Math.abs(Math.cos(angle)) * this.speed);
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
