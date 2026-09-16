import type { Object3D } from 'three';
import { Component, Input, KeyCode, MouseButton, SceneManager, type SceneType } from '@scenoco-three/core';
import type { Text } from '@scenoco-three/ui';
import type { GameState } from './GameState.js';
import { nonSerialized } from '@scenoco-three/compiler/serialize';

/**
 * The run — score, lives, which level — and the HUD that shows it.
 *
 * It lives in `hud.scene.xml`, a scene marked `dontDestroyOnLoad`, so it is the one thing in
 * the game a level load does not touch. That is why the two halves are together: the score has
 * to outlive the level, and so does the readout showing it, and a persistent scene keeps both
 * without anything having to copy state across the seam.
 *
 * The level's own rules live in `GameState`, a system rebuilt with every level. It finds this
 * through `SceneManager.findObjectOfType` — a global lookup, as Unity's is — and reports to it.
 */
export class Progress extends Component {
  /**
   * The levels, in order.
   *
   * Authored: `levels="[level-1.scene.xml, level-2.scene.xml, level-3.scene.xml]"`. A scene
   * compiles to a class and `SceneManager.load` takes one, so a scene is referenced by path
   * exactly like a geometry or a material — and a list of them is the ordinary bracketed list.
   *
   * It is declared *here*, in a scene no level imports, so nothing is circular: the HUD knows
   * the levels, and a level knows only its own rules.
   */
  levels: SceneType[] = [];

  startingLives = 3;
  /** Points a brick is worth, multiplied by how many hits it took to break. */
  pointsPerHit = 50;

  // The widgets, wired by `#id` in the document.
  scoreText!: Text;
  levelText!: Text;
  life1!: Object3D;
  life2!: Object3D;
  life3!: Object3D;
  banner!: Object3D;
  headline!: Text;
  hint!: Text;

  // The run itself: what the game counts, not what a document configures.
  @nonSerialized score = 0;
  @nonSerialized lives = 3;
  /** 0-based index into `levels`. */
  @nonSerialized index = 0;

  /** The level being played, which owns the phase. Null between loads. */
  private game: GameState | null = null;

  override awake(): void {
    this.lives = this.startingLives;
  }

  override start(): void {
    this.redraw();
  }

  override update(): void {
    const phase = this.game?.phase;
    if (phase === 'ready' || phase === 'playing') return;
    // Between rounds the whole screen is the button.
    if (Input.getMouseButtonDown(MouseButton.Left) || Input.getKeyDown(KeyCode.Space)) this.advance();
  }

  // --- what the level tells it ------------------------------------------------------------

  /** Called from a level's `GameState.start`, which is the moment that level is fully built. */
  beginLevel(game: GameState): void {
    this.game = game;
    this.redraw();
  }

  /** A brick broke. */
  award(hitsTaken: number): void {
    this.score += this.pointsPerHit * hitsTaken;
    this.redraw();
  }

  /** The ball was missed. True while there is still a ball to lose. */
  loseLife(): boolean {
    this.lives -= 1;
    this.redraw();
    return this.lives > 0;
  }

  /** True when the level just cleared was the last one. */
  get onLastLevel(): boolean {
    return this.index + 1 >= this.levels.length;
  }

  // --- moving between levels --------------------------------------------------------------

  /** A tap on the banner: on to the next level, or back to the first. */
  advance(): void {
    const phase = this.game?.phase;
    if (phase === 'cleared') {
      this.go(this.index + 1);
      return;
    }
    if (phase === 'lost' || phase === 'won') {
      this.score = 0;
      this.lives = this.startingLives;
      this.go(0);
    }
  }

  private go(index: number): void {
    const next = this.levels[index];
    if (!next) return;
    this.index = index;
    this.game = null;
    void SceneManager.load(next);
  }

  // --- drawing ----------------------------------------------------------------------------

  redraw(): void {
    this.scoreText.text = String(this.score).padStart(5, '0');
    // ASCII only: the default font has no glyph for a middle dot or an em dash, and a missing
    // glyph draws as a tofu box — the same reason the lives are pips rather than hearts.
    this.levelText.text = `${this.index + 1}/${this.levels.length}  ${this.game?.levelName ?? ''}`;
    const pips = [this.life1, this.life2, this.life3];
    pips.forEach((pip, index) => pip.setActive(index < this.lives));

    const message = MESSAGES[this.game?.phase ?? 'ready'];
    this.banner.setActive(message !== null);
    if (!message) return;
    this.headline.text = message.headline;
    this.hint.text = message.hint;
  }
}

/** What the banner says, or `null` where there is no banner. */
const MESSAGES: Record<GameState['phase'], { headline: string; hint: string } | null> = {
  ready: null,
  playing: null,
  cleared: { headline: 'LEVEL CLEARED', hint: 'tap to continue' },
  lost: { headline: 'GAME OVER', hint: 'tap to try again' },
  won: { headline: 'YOU WIN', hint: 'tap to play again' },
};
