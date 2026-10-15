import { Behaviour, Input, KeyCode, SceneManager, dontDestroyOnLoad } from '@scenoco-three/core';
import type { GameState } from './GameState';

/**
 * The run — score, lives, which level — and the HUD that shows it.
 *
 * It lives in the `Run` scene, which it keeps with `dontDestroyOnLoad`, so it is the one thing in
 * the game a level load does not touch: the score outlives the level that earned it, and nothing
 * has to copy state across the seam.
 *
 * The level's own rules live in `GameState`, rebuilt with every level. It finds this through
 * `findObjectOfType` — a global lookup, as Unity's is — and reports to it.
 *
 * The HUD is the page's own HTML (`index.html`): this writes the numbers into it, and the banner
 * between rounds is a `data-button="Continue"` — a button `Input.getButtonDown` reads like a key.
 */
export class Progress extends Behaviour {
  /** The levels, in order: scene functions, as `SceneManager.load` takes them. */
  levels: (() => unknown)[] = [];

  startingLives = 3;
  /** Points a brick is worth, multiplied by how many hits it took to break. */
  pointsPerHit = 50;

  // The run itself: what the game counts, not what a scene configures.
  private score = 0;
  private lives = 3;
  /** 0-based index into `levels`. */
  private index = 0;
  /** The level being played, which owns the phase. Null between loads. */
  private game: GameState | null = null;

  private readonly hud = {
    score: element('score'),
    level: element('level'),
    lives: element('lives'),
    banner: element('banner'),
    headline: element('headline'),
    hint: element('hint'),
  };

  override awake(): void {
    dontDestroyOnLoad(this);
    this.lives = this.startingLives;
  }

  override start(): void {
    this.go(0);
  }

  override update(): void {
    const phase = this.game?.phase;
    if (phase === 'ready' || phase === 'playing') return;
    if (Input.getButtonDown('Continue') || Input.getKeyDown(KeyCode.Space)) this.advance();
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
    if (phase === 'cleared') return this.go(this.index + 1);
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
    SceneManager.load(next);
  }

  // --- drawing ----------------------------------------------------------------------------

  redraw(): void {
    this.hud.score.textContent = String(this.score).padStart(5, '0');
    this.hud.level.textContent = `${this.index + 1}/${this.levels.length} · ${this.game?.levelName ?? ''}`;
    [...this.hud.lives.children].forEach((pip, i) => pip.classList.toggle('spent', i >= this.lives));

    const message = MESSAGES[this.game?.phase ?? 'ready'];
    this.hud.banner.hidden = message === null;
    if (!message) return;
    this.hud.headline.textContent = message.headline;
    this.hud.hint.textContent = message.hint;
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

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html has no #${id} — the HUD is the page's own HTML.`);
  return found;
}
