import { Event, SceneManager, System } from '@scenoco-three/core';
import { Progress } from './Progress.js';
import type { Brick } from './Brick.js';

/** What the level is doing right now. The HUD reads it; the ball obeys it. */
export type Phase = 'ready' | 'playing' | 'cleared' | 'lost' | 'won';

/**
 * One level's rules, as a scene service.
 *
 * A system rather than a component because it belongs to no node: every brick needs to reach
 * it, and it is not a property of any of them. Bricks register themselves in `awake` — the same
 * line a rigid body writes to join the physics world — so nothing queries the scene.
 *
 * It owns what is true *of this level*: the phase, and how many bricks are left. What is true
 * of the **run** — the score, the lives, which level this is — belongs to `Progress`, which
 * outlives the level. Reaching it is the one lookup here, and it happens in `start`, because
 * that is where a system may read the world: by then the whole document is built.
 */
export class GameState extends System {
  /** Shown on the HUD. Authored per level. */
  levelName = 'Level';

  /** Raised when the ball should be put back on the paddle and stopped. */
  readonly ballReset = new Event();

  phase: Phase = 'ready';

  private readonly bricks = new Set<Brick>();
  /**
   * The run this level is part of, or `null` when there is none.
   *
   * Null is a real case rather than an error: open `level-2.scene.xml` on its own in the editor
   * and the HUD scene is not loaded, because nothing in this document references it. The level
   * still plays — it simply has nothing to report to, which is better than a level that cannot
   * be opened without its bootstrap scene.
   */
  private progress: Progress | null = null;

  override start(): void {
    // A global lookup, exactly as Unity's `FindObjectOfType` is: the HUD is in another scene —
    // the persistent one — so no reference in this document could reach it.
    this.progress = SceneManager.findObjectOfType(Progress);
    this.progress?.beginLevel(this);
  }

  get bricksLeft(): number {
    return this.bricks.size;
  }

  // --- what the scene tells it ------------------------------------------------------------

  /** Called by every brick in `awake`, which is how the system learns the level's size. */
  register(brick: Brick): void {
    this.bricks.add(brick);
  }

  /** A brick took its last hit. */
  broke(brick: Brick, hitsTaken: number): void {
    if (!this.bricks.delete(brick)) return;
    this.progress?.award(hitsTaken);
    if (this.bricks.size === 0) this.clear();
  }

  /** The ball fell past the paddle. */
  missed(): void {
    if (this.phase !== 'playing') return;
    // With no run to spend a life from, the ball simply goes back on the paddle.
    if (this.progress && !this.progress.loseLife()) {
      this.phase = 'lost';
      this.progress.redraw();
      return;
    }
    this.phase = 'ready';
    this.ballReset.emit();
    this.progress?.redraw();
  }

  /** The player launched the ball. */
  launched(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'playing';
    this.progress?.redraw();
  }

  private clear(): void {
    this.phase = this.progress?.onLastLevel === false ? 'cleared' : 'won';
    this.ballReset.emit();
    this.progress?.redraw();
  }
}
