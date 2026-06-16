import type { Object3D } from 'three';
import { Component, component, property } from '@scenoco-three/core';
import { GridLayout, type GridCell } from './GridLayout.js';
import { Brick } from './Brick.js';
import { GameManager } from './GameManager.js';

// Ball geometry constants (must match the SphereGeometry radius in the scene XML)
const BALL_RADIUS = 0.3;

// Paddle half-extents (must match the BoxGeometry in scene XML: width=3, height=0.4)
const PADDLE_HW = 1.5;
const PADDLE_HH = 0.2;

// Field bounce limits — inner faces of the wall meshes minus ball radius
const BOUND_LEFT = -7.7; // wall left inner face: -8.0 + BALL_RADIUS
const BOUND_RIGHT = 7.7; // wall right inner face: 8.0 - BALL_RADIUS
const BOUND_TOP = 13.7; // top wall inner face: 14.0 - BALL_RADIUS
const LOSE_Y = -1.0; // below this the ball is lost

/**
 * Controls ball movement and all collision responses for the Breakout game.
 *
 * The ball lives at the origin of the scene (Z=0); physics are 2D (XY plane).
 * Collision is AABB-based: walls/top are half-planes, paddle and bricks use
 * separating-axis overlap with minimum-penetration side selection.
 *
 * Cross-component links (resolved by the engine from XML `#id` refs):
 *   paddle      — the paddle's Object3D (type: 'node') → position for tracking + hit test
 *   bricks      — GridLayout component → liveCells() and remove() of the brick grid
 *   gameManager — GameManager component → state flags and event callbacks
 *
 * Circular-import guard: BallController imports GameManager; GameManager does NOT
 * import BallController. Instead, GameManager sets `pendingBallReset = true` when
 * the game restarts, and this component polls that flag each update.
 */
@component({
  name: 'BallController',
  description: 'Breakout ball: movement, wall/paddle/brick collision, launch on Space',
})
export class BallController extends Component {
  /** The paddle Mesh's Object3D — resolved by the engine from `paddle="#paddle"` in XML. */
  @property({ type: 'node', description: 'The paddle node (for collision and tracking)' })
  paddle: Object3D | null = null;

  @property(GridLayout)
  bricks: GridLayout | null = null;

  @property(GameManager)
  gameManager: GameManager | null = null;

  @property({ type: 'float', default: 12, description: 'Ball speed in world units per second' })
  speed = 12;

  /** Current velocity (X and Y components). Zero while the ball is waiting. */
  vx = 0;
  vy = 0;
  launched = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.handleSpace();
  };

  private handleSpace(): void {
    const gm = this.gameManager;
    if (!gm || gm.lives <= 0 || gm.isPlaying || this.launched) return;
    gm.startRound();
    this.launch();
  }

  override onLoad(): void {
    window.addEventListener('keydown', this.onKeyDown);
    this.resetToPaddle();
  }

  override onDestroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  /** Fire the ball at a randomised upward angle centred on straight-up. */
  launch(): void {
    this.launched = true;
    // 60–120° from positive X axis (always upward); slight random spread
    const angle = (Math.PI / 2) + (Math.random() - 0.5) * (Math.PI / 3);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.abs(Math.sin(angle)) * this.speed;
  }

  /** Snap ball to top of paddle, clear velocity. GameManager calls this via the flag. */
  resetToPaddle(): void {
    this.launched = false;
    this.vx = 0;
    this.vy = 0;
    if (this.paddle) {
      this.node.position.x = this.paddle.position.x;
      this.node.position.y = this.paddle.position.y + PADDLE_HH + BALL_RADIUS + 0.05;
    } else {
      this.node.position.set(0, PADDLE_HH + BALL_RADIUS + 0.55, 0);
    }
    this.node.position.z = 0;
  }

  override update(dt: number): void {
    // Honour a restart request from GameManager (avoids circular import by polling a flag)
    if (this.gameManager?.pendingBallReset) {
      this.gameManager.pendingBallReset = false;
      this.resetToPaddle();
      return;
    }

    if (!this.launched) {
      // Track the paddle's X so the ball stays centred on it before launch.
      if (this.paddle) {
        this.node.position.x = this.paddle.position.x;
      }
      return;
    }

    const pos = this.node.position;

    // ── Integrate ────────────────────────────────────────────────────────────
    pos.x += this.vx * dt;
    pos.y += this.vy * dt;

    // ── Wall bounces ─────────────────────────────────────────────────────────
    if (pos.x < BOUND_LEFT) {
      pos.x = BOUND_LEFT;
      this.vx = Math.abs(this.vx);
    }
    if (pos.x > BOUND_RIGHT) {
      pos.x = BOUND_RIGHT;
      this.vx = -Math.abs(this.vx);
    }
    if (pos.y > BOUND_TOP) {
      pos.y = BOUND_TOP;
      this.vy = -Math.abs(this.vy);
    }

    // ── Ball lost ────────────────────────────────────────────────────────────
    if (pos.y < LOSE_Y) {
      this.gameManager?.onBallLost();
      this.resetToPaddle();
      return;
    }

    // ── Paddle collision ──────────────────────────────────────────────────────
    if (this.paddle && this.vy < 0) {
      const px = this.paddle.position.x;
      const py = this.paddle.position.y;
      const dx = Math.abs(pos.x - px);
      const dy = Math.abs(pos.y - py);

      if (dx < PADDLE_HW + BALL_RADIUS && dy < PADDLE_HH + BALL_RADIUS) {
        // Reflect upward; angle depends on where along the paddle the hit landed.
        // Centre hit → straight up; edge hit → steeper angle, max ±60°.
        const relHit = Math.max(-1, Math.min(1, (pos.x - px) / PADDLE_HW));
        const angle = (Math.PI / 2) + relHit * (Math.PI / 3);
        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.abs(Math.sin(angle)) * this.speed;
        pos.y = py + PADDLE_HH + BALL_RADIUS + 0.01; // push out of overlap
      }
    }

    // ── Brick collision ──────────────────────────────────────────────────────
    if (!this.bricks) return;

    for (const cell of this.bricks.liveCells()) {
      const brick = this.brickOf(cell);
      if (!brick) continue;

      // The brick mesh is parented under the grid node (at the origin), so its
      // local position is its field position — same as the ball's.
      const bx = cell.root.position.x;
      const by = cell.root.position.y;

      const dx = Math.abs(pos.x - bx);
      const dy = Math.abs(pos.y - by);

      const overlapX = brick.halfWidth + BALL_RADIUS - dx;
      const overlapY = brick.halfHeight + BALL_RADIUS - dy;

      if (overlapX <= 0 || overlapY <= 0) continue;

      // Hit: remove the brick instance and notify the game manager.
      this.bricks.remove(cell);
      this.gameManager?.onBrickDestroyed(brick.points);

      // Reflect off the face with the smallest penetration depth.
      if (overlapX < overlapY) {
        this.vx = -this.vx;
        pos.x += pos.x < bx ? -overlapX : overlapX;
      } else {
        this.vy = -this.vy;
        pos.y += pos.y < by ? -overlapY : overlapY;
      }

      // Process at most one brick per frame to avoid compounding reflections.
      break;
    }
  }

  /** The Brick data component on a spawned grid cell's root node. */
  private brickOf(cell: GridCell): Brick | null {
    for (const c of this.engine.getComponents(cell.root)) {
      if (c instanceof Brick) return c;
    }
    return null;
  }
}
