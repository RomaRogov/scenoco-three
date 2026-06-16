import { Component, component, property } from '@scenoco-three/core';
import { GridLayout } from './GridLayout.js';

/**
 * Manages Breakout game state: score, lives, win/lose transitions, and the HUD.
 *
 * GameManager is an invisible Object3D (no geometry). It receives event callbacks
 * from BallController and tracks authoritative game state.
 *
 * Circular-import resolution: BallController imports GameManager; GameManager does
 * NOT import BallController. Instead of a direct reference, GameManager sets
 * `pendingBallReset = true` when a restart is needed, and BallController polls
 * this flag each update to reset the ball's position itself.
 *
 * DOM overlay (HUD + message box) is updated directly here because SceNoCo has
 * no scene-native UI layer — elements are expected in index.html.
 */
@component({
  name: 'GameManager',
  description: 'Breakout game state: score, lives, HUD and win/lose transitions',
})
export class GameManager extends Component {
  @property(GridLayout)
  bricks: GridLayout | null = null;

  @property({ type: 'int', default: 3, description: 'Starting number of lives' })
  startLives = 3;

  score = 0;
  lives = 3;
  /** True when the ball is actively in play. */
  isPlaying = false;
  /**
   * Polled by BallController every update — set to `true` by restartGame().
   * BallController reads this, resets the ball position, then clears the flag.
   * This pattern avoids importing BallController here (which would be circular).
   */
  pendingBallReset = false;

  private hudEl: HTMLElement | null = null;
  private messageEl: HTMLElement | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR') this.restartGame();
  };

  override onLoad(): void {
    this.lives = this.startLives;
    this.isPlaying = false;
    this.hudEl = document.getElementById('hud');
    this.messageEl = document.getElementById('message');
    window.addEventListener('keydown', this.onKeyDown);
    this.updateHud();
    this.showMessage('BREAKOUT\n\nPress SPACE to launch\nArrow keys / WASD to move\nR to restart');
  }

  override onDestroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  /** Called by BallController when the ball exits the bottom of the field. */
  onBallLost(): void {
    this.lives = Math.max(0, this.lives - 1);
    this.isPlaying = false;
    this.updateHud();
    if (this.lives <= 0) {
      this.showMessage(`GAME OVER\n\nFinal score: ${this.score}\n\nPress R to play again`);
    } else {
      const plural = this.lives === 1 ? 'life' : 'lives';
      this.showMessage(`Ball lost!\n${this.lives} ${plural} remaining\n\nPress SPACE to continue`);
    }
  }

  /** Called by BallController each time a brick is destroyed. */
  onBrickDestroyed(points: number): void {
    this.score += points;
    this.updateHud();
    if (this.bricks && this.bricks.liveCount === 0) {
      this.isPlaying = false;
      this.showMessage(`YOU WIN!\n\nScore: ${this.score}\n\nPress R to play again`);
    }
  }

  /**
   * Called by BallController when Space is pressed and the game is not yet live.
   * Marks the round as started and hides the splash message.
   */
  startRound(): void {
    this.isPlaying = true;
    this.hideMessage();
  }

  private restartGame(): void {
    this.score = 0;
    this.lives = this.startLives;
    this.isPlaying = false;
    this.bricks?.rebuild();
    // Signal the ball to reset on its next update tick (avoids circular import).
    this.pendingBallReset = true;
    this.updateHud();
    this.showMessage('BREAKOUT\n\nPress SPACE to launch\nArrow keys / WASD to move\nR to restart');
  }

  private updateHud(): void {
    if (!this.hudEl) return;
    const filled = '●'.repeat(Math.max(0, this.lives));
    const empty = '○'.repeat(Math.max(0, this.startLives - this.lives));
    this.hudEl.textContent = `Score: ${this.score}   Lives: ${filled}${empty}`;
  }

  private showMessage(text: string): void {
    if (this.messageEl) {
      this.messageEl.textContent = text;
      this.messageEl.style.display = 'block';
    }
  }

  private hideMessage(): void {
    if (this.messageEl) {
      this.messageEl.style.display = 'none';
    }
  }
}
