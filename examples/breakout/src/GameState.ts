import type { Vector3 } from 'three';
import { Behaviour, Event, destroy, findObjectOfType, findObjectsOfType } from '@scenoco-three/core';
import { Progress } from './Progress.js';
import { Sfx } from './Sfx.js';
import { Pickup } from './Pickup.js';
import { Bolt } from './Bolt.js';
import type { Ball } from './Ball.js';
import type { Brick } from './Brick.js';

/**
 * What the level is doing right now. The HUD reads it; the ball obeys it. `title` is the first
 * level behind the splash, before the player has pressed PLAY.
 */
export type Phase = 'title' | 'ready' | 'playing' | 'cleared' | 'lost' | 'won';

/**
 * One level's rules, on the level's scene: `<Scene><GameState levelName="NEON GRID" />…`.
 *
 * Bricks and balls find it with `findObjectOfType` and register in `awake`, so it knows how many of
 * each there are. It owns what is true *of this level*: the phase, the bricks and balls left, and the
 * combo of the current rally. What is true of the **run** — score, lives, which level — belongs to
 * `Progress`, which outlives the level.
 */
export class GameState extends Behaviour {
  /** Shown on the HUD. Authored per level. */
  levelName = 'Level';
  /** How fast every ball travels here, in units per second — constant, whatever it bounces off. */
  ballSpeed = 15;

  /** Raised when the last ball is lost and the one left should go back on the paddle. */
  readonly ballReset = new Event();
  /** The last ball fell: the music drops. */
  readonly ballLost = new Event();
  /** Something hit hard enough to shake the camera, from 0 to 1. */
  readonly impact = new Event<[strength: number]>();

  phase: Phase = 'ready';
  /** Bricks broken since the ball last touched the paddle: each one is worth that many times more. */
  combo = 0;

  private readonly bricks = new Set<Brick>();
  private readonly balls = new Set<Ball>();
  /** The run, or `null` when the level is played on its own (`play(Level2)`): it still plays. */
  private progress: Progress | null = null;
  /** The run's sound effects: null when the level is played on its own. */
  sfx: Sfx | null = null;

  override awake(): void {
    this.sfx = findObjectOfType(Sfx);
  }

  override start(): void {
    this.progress = findObjectOfType(Progress);
    this.progress?.beginLevel(this);
  }

  get bricksLeft(): number {
    return this.bricks.size;
  }

  get ballsInPlay(): number {
    return this.balls.size;
  }

  // --- what the scene tells it ------------------------------------------------------------

  register(brick: Brick): void {
    this.bricks.add(brick);
  }

  addBall(ball: Ball): void {
    this.balls.add(ball);
  }

  removeBall(ball: Ball): void {
    this.balls.delete(ball);
  }

  /** A brick took its last hit, at `at`. */
  broke(brick: Brick, hitsTaken: number, at: Vector3): void {
    if (!this.bricks.delete(brick)) return;
    this.combo += 1;
    this.progress?.award(hitsTaken, this.combo, at);
    this.impact.emit(0.12 + 0.06 * hitsTaken);
    if (this.bricks.size === 0) this.clear();
  }

  /** The ball came back to the paddle: the rally's combo starts again. */
  returned(): void {
    this.combo = 0;
  }

  /** A ball fell past the paddle. Only the last one costs a life. */
  lost(ball: Ball): void {
    if (this.phase !== 'playing') return;
    if (this.balls.size > 1) {
      this.balls.delete(ball);
      destroy(ball.node);
      return;
    }
    this.combo = 0;
    this.impact.emit(1);
    this.ballLost.emit();
    this.sweep();
    if (this.progress && !this.progress.loseLife()) {
      this.phase = 'lost';
      this.sfx?.play('over');
      this.progress.redraw();
      return;
    }
    this.sfx?.play('lose');
    this.phase = 'ready';
    this.ballReset.emit();
    this.progress?.redraw();
  }

  /** Multi-ball: every ball in play becomes three. */
  multiply(): void {
    if (this.phase !== 'playing') return;
    for (const ball of [...this.balls]) ball.split();
  }

  /** The player launched the ball. */
  launched(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'playing';
    this.sfx?.play('launch');
    this.progress?.redraw();
  }

  /** Pickups still falling and bolts still flying go with the rally that made them. */
  private sweep(): void {
    for (const pickup of findObjectsOfType(Pickup)) destroy(pickup.node);
    for (const bolt of findObjectsOfType(Bolt)) destroy(bolt.node);
  }

  private clear(): void {
    this.phase = this.progress?.onLastLevel === false ? 'cleared' : 'won';
    this.sfx?.play(this.phase === 'won' ? 'win' : 'clear');
    this.sweep();
    // One ball goes back on the paddle; a multi-ball's others go.
    for (const ball of [...this.balls].slice(1)) {
      this.balls.delete(ball);
      destroy(ball.node);
    }
    this.ballReset.emit();
    this.progress?.redraw();
  }
}
