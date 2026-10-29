import { Vector3 } from 'three';
import { Behaviour, Input, KeyCode, SceneManager, WaitForSecondsRealtime, dontDestroyOnLoad, findObjectOfType } from '@scenoco-three/core';
import { bonuses } from './assets.js';
import { Paddle } from './Paddle.js';
import type { GameState } from './GameState.js';

/**
 * The run — score, lives, which level — and the HUD that shows it.
 *
 * It lives in the `Run` scene, which it keeps with `dontDestroyOnLoad`, so it is the one thing a level
 * load does not touch: the score outlives the level that earned it, and nothing copies state across.
 * The level's own rules live in `GameState`, rebuilt with every level, which reports here.
 *
 * The HUD is the page's own HTML (`index.html`): this writes the numbers into it, floats each brick's
 * points up from where it broke, and draws the running bonuses' timers. The banner between rounds is
 * a `data-button="Continue"` — a button `Input.getButtonDown` reads like a key.
 *
 * The run opens on a splash with a PLAY button, the first level waiting behind it. That press is the
 * player's first touch of the page, which is what a browser waits for before it lets sound play — so
 * the music starts from its first bar with the game, not halfway into the first rally.
 *
 * Nothing changes with a cut: a level change fades the screen to black and back (the music, which
 * reads `changing`, fades with it), a stage opens with its name, and a lost ball flashes the screen
 * red and takes its pip away. The motion is the page's CSS; this only says when.
 */
export class Progress extends Behaviour {
  /** The levels, in order: scene functions, as `SceneManager.load` takes them. */
  levels: (() => unknown)[] = [];
  startingLives = 3;
  /** Points a brick is worth, times the hits it took, times the rally's combo. */
  pointsPerHit = 50;

  private score = 0;
  private lives = 3;
  /** 0-based index into `levels`. */
  private index = 0;
  /** The level being played, which owns the phase. Null between loads. */
  private game: GameState | null = null;
  private paddle: Paddle | null = null;
  /** False until PLAY is pressed on the splash. */
  private begun = false;
  private fading = false;
  private drawnCombo = 0;
  private drawnEffects = '';
  private shownBonuses = new Set<string>();

  private readonly hud = {
    score: element('score'),
    level: element('level'),
    lives: element('lives'),
    combo: element('combo'),
    effects: element('effects'),
    popups: element('popups'),
    banner: element('banner'),
    splash: element('splash'),
    bar: element('hud'),
    fade: element('fade'),
    flash: element('flash'),
    intro: element('intro'),
    headline: element('headline'),
    hint: element('hint'),
  };

  override awake(): void {
    dontDestroyOnLoad(this);
    this.lives = this.startingLives;
  }

  override start(): void {
    // The page opens already black: the first level fades in from it, with no fade out first.
    this.load(0);
  }

  override update(): void {
    const phase = this.game?.phase;
    if (phase === 'title' || phase === 'ready' || phase === 'playing' || this.fading) return;
    if (Input.getButtonDown('Continue') || Input.getKeyDown(KeyCode.Space)) this.advance();
  }

  /** Every frame, what moves on its own: the combo, and the bonuses' timers running down. */
  override lateUpdate(): void {
    // After every update has run, so the press that leaves the splash cannot also launch the ball.
    const start = Input.getButtonDown('Play') || Input.getKeyDown(KeyCode.Space) || Input.getKeyDown(KeyCode.Return);
    if (this.game?.phase === 'title' && start) {
      this.begun = true;
      this.game.phase = 'ready';
      this.redraw();
      this.hud.bar.classList.add('shown');
      this.introduce();
    }

    const combo = this.game?.combo ?? 0;
    if (combo !== this.drawnCombo) {
      this.drawnCombo = combo;
      this.hud.combo.textContent = combo > 1 ? `COMBO ×${combo}` : '';
      if (combo > 1) bump(this.hud.combo);
    }
    const running = this.paddle?.running ?? [];
    const names = running.map((e) => e.bonus).join();
    if (names !== this.drawnEffects) {
      this.drawnEffects = names;
      this.hud.effects.replaceChildren(
        ...running.map((e) => {
          const chip = document.createElement('div');
          // Only a bonus new since the last drawing pops in; the others are redrawn as they were.
          chip.className = this.shownBonuses.has(e.bonus) ? 'chip' : 'chip new';
          chip.style.setProperty('--tint', bonuses[e.bonus].color);
          chip.innerHTML = `<span>${bonuses[e.bonus].label}</span><i></i>`;
          return chip;
        }),
      );
      this.shownBonuses = new Set(running.map((e) => e.bonus));
    }
    running.forEach((e, i) => (this.hud.effects.children[i] as HTMLElement | undefined)?.style.setProperty('--left', String(e.left / e.total)));
  }

  // --- what the level tells it ------------------------------------------------------------

  /** Called from a level's `GameState.start`, which is the moment that level is fully built. */
  beginLevel(game: GameState): void {
    this.game = game;
    if (!this.begun) game.phase = 'title';
    this.paddle = findObjectOfType(Paddle);
    this.fading = false;
    this.hud.fade.classList.remove('shut');
    this.redraw();
    if (this.begun) this.introduce();
  }

  /** A brick broke at `at`: its points, and a number floating up from where it was. */
  award(hitsTaken: number, combo: number, at: Vector3): void {
    const points = this.pointsPerHit * hitsTaken * Math.max(1, combo);
    this.score += points;
    this.redraw();
    bump(this.hud.score);
    this.popup(`+${points}`, at, combo > 1);
  }

  /** The ball was missed. True while there is still a ball to lose. */
  loseLife(): boolean {
    this.lives -= 1;
    // The pip that goes bursts first; the screen flashes red behind it.
    (this.hud.lives.children[this.lives] as HTMLElement | undefined)?.classList.add('losing');
    replay(this.hud.flash, 'on');
    this.redraw();
    return this.lives > 0;
  }

  /** True from the moment a level change starts fading out until the next level is in. */
  get changing(): boolean {
    return this.fading;
  }

  /** Which level is being played, from 0. */
  get stage(): number {
    return this.index;
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

  /** To level `index`: the screen fades to black, the level loads behind it, and fades in. */
  private go(index: number): void {
    if (this.fading || !this.levels[index]) return;
    this.fading = true;
    this.startCoroutine(this.fadeTo(index));
  }

  private *fadeTo(index: number) {
    this.hud.fade.classList.add('shut');
    yield new WaitForSecondsRealtime(0.6); // the CSS transition's length
    this.load(index);
  }

  private load(index: number): void {
    this.index = index;
    this.game = null;
    this.paddle = null;
    this.fading = true;
    SceneManager.load(this.levels[index]!);
  }

  /** The stage's number and name, across the screen for a moment as it opens. */
  private introduce(): void {
    this.hud.intro.innerHTML = `<small>STAGE ${this.index + 1}</small>${this.game?.levelName ?? ''}`;
    replay(this.hud.intro, 'on');
  }

  // --- drawing ----------------------------------------------------------------------------

  redraw(): void {
    this.hud.score.textContent = String(this.score).padStart(5, '0');
    this.hud.level.textContent = `${this.index + 1}/${this.levels.length} · ${this.game?.levelName ?? ''}`;
    [...this.hud.lives.children].forEach((pip, i) => pip.classList.toggle('spent', i >= this.lives));

    this.hud.splash.classList.toggle('gone', this.game?.phase !== 'title');
    [...this.hud.lives.children].forEach((pip, i) => i >= this.lives || pip.classList.remove('losing'));
    const message = MESSAGES[this.game?.phase ?? 'ready'];
    this.hud.banner.hidden = message === null;
    if (!message) return;
    this.hud.banner.dataset.mood = message.mood;
    this.hud.headline.textContent = message.headline;
    this.hud.headline.dataset.mood = message.mood;
    this.hud.hint.textContent = message.hint;
  }

  /** A number rising from a point of the world, then gone: CSS animates it, the DOM drops it. */
  private popup(text: string, at: Vector3, hot: boolean): void {
    const camera = this.camera;
    if (!camera) return;
    const screen = at.clone().project(camera);
    const label = document.createElement('div');
    label.className = hot ? 'popup hot' : 'popup';
    label.textContent = text;
    label.style.left = `${((screen.x + 1) / 2) * 100}%`;
    label.style.top = `${((1 - screen.y) / 2) * 100}%`;
    label.addEventListener('animationend', () => label.remove());
    this.hud.popups.append(label);
  }
}

/** What the banner says, or `null` where there is no banner. */
const MESSAGES: Record<GameState['phase'], { headline: string; hint: string; mood: string } | null> = {
  title: null,
  ready: null,
  playing: null,
  cleared: { headline: 'LEVEL CLEAR', hint: 'TAP TO CONTINUE', mood: 'good' },
  lost: { headline: 'GAME OVER', hint: 'TAP TO TRY AGAIN', mood: 'bad' },
  won: { headline: 'YOU WIN', hint: 'TAP TO PLAY AGAIN', mood: 'good' },
};

/** Play an element's `.bump` animation again from the start. */
function bump(element: HTMLElement): void {
  replay(element, 'bump');
}

/** Put `className` back on an element so its CSS animation plays again from the start. */
function replay(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth; // a reflow, so the class coming back restarts the animation
  element.classList.add(className);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html has no #${id} — the HUD is the page's own HTML.`);
  return found;
}
