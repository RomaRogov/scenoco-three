import { Vector3 } from 'three';
import { Behaviour, Input, KeyCode, SceneManager, Screen, WaitForSecondsRealtime, dontDestroyOnLoad, findObjectOfType, type Yieldable } from '@scenoco-three/core';
import { Paddle } from './Paddle.js';
import type { Bonus } from './bonus.js';
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
 * red and takes its pip away. The motion is the page's CSS transitions; this only says when, by
 * putting a class on and taking it off — what a port to UI Toolkit does with the same USS.
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

  private hud!: Record<
    'ui' | 'score' | 'level' | 'lives' | 'combo' | 'effects' | 'popups' | 'banner' | 'splash' | 'title' | 'playGlow' | 'bar' | 'fade' | 'flash' | 'intro' | 'introStage' | 'introName' | 'headline' | 'hint',
    HTMLElement
  >;
  private chip!: HTMLTemplateElement;
  private popupTemplate!: HTMLTemplateElement;

  override awake(): void {
    dontDestroyOnLoad(this);
    this.lives = this.startingLives;
    this.hud = {
      ui: element('ui'),
      score: element('score'),
      level: element('level'),
      lives: element('lives'),
      combo: element('combo'),
      effects: element('effects'),
      popups: element('popups'),
      banner: element('banner'),
      splash: element('splash'),
      title: element('title'),
      playGlow: element('play-glow'),
      bar: element('hud'),
      fade: element('fade'),
      flash: element('flash'),
      intro: element('intro'),
      introStage: element('intro-stage'),
      introName: element('intro-name'),
      headline: element('headline'),
      hint: element('hint'),
    };
    this.chip = element('chip') as HTMLTemplateElement;
    this.popupTemplate = element('popup') as HTMLTemplateElement;
  }

  override start(): void {
    // The page opens already black: the first level fades in from it, with no fade out first.
    this.load(0);
    // The splash's title arrives; PLAY pulses and the banner's hint blinks for as long as the run lasts.
    this.startCoroutine(this.arrive(this.hud.title, 'arriving'));
    this.startCoroutine(this.pulse(this.hud.playGlow, 'bright', 0.8));
    this.startCoroutine(this.pulse(this.hud.hint, 'dim', 0.6));
  }

  override update(): void {
    const phase = this.game?.phase;
    if (phase === 'title' || phase === 'ready' || phase === 'playing' || this.fading) return;
    if (Input.getButtonDown('Continue') || Input.getKeyDown(KeyCode.Space) || Input.getKeyDown(KeyCode.JoystickButton0)) this.advance();
  }

  /** Every frame, what moves on its own: the combo, and the bonuses' timers running down. */
  override lateUpdate(): void {
    // A phone held upright gets the narrower sizes: UI Toolkit has no media queries.
    this.hud.ui.classList.toggle('portrait', Screen.height > Screen.width);
    // After every update has run, so the press that leaves the splash cannot also launch the ball.
    // PLAY, Space or Enter — or a gamepad's A or Start.
    const start =
      Input.getButtonDown('Play') || Input.getKeyDown(KeyCode.Space) || Input.getKeyDown(KeyCode.Return) ||
      Input.getKeyDown(KeyCode.JoystickButton0) || Input.getKeyDown(KeyCode.JoystickButton9);
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
      if (combo > 1) this.startCoroutine(this.flick(this.hud.combo, 'bump', 0.09));
    }
    const running = this.paddle?.running ?? [];
    const names = running.map((e) => e.bonus).join();
    if (names !== this.drawnEffects) {
      this.drawnEffects = names;
      const chips = running.map((e) => {
        const chip = clone(this.chip);
        // Its colour is the page's CSS, by the bonus's class.
        chip.classList.add(e.bonus);
        (chip.querySelector('.name') as HTMLElement).textContent = LABELS[e.bonus];
        // Only a bonus new since the last drawing pops in; the others are redrawn as they were.
        if (!this.shownBonuses.has(e.bonus)) this.startCoroutine(this.arrive(chip, 'new'));
        return chip;
      });
      this.hud.effects.replaceChildren(...chips);
      this.shownBonuses = new Set(running.map((e) => e.bonus));
    }
    running.forEach((e, i) => {
      const timer = this.hud.effects.children[i]?.querySelector('.timer') as HTMLElement | null;
      if (timer) timer.style.scale = `${e.left / e.total} 1`;
    });
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
    this.startCoroutine(this.flick(this.hud.score, 'bump', 0.09));
    this.popup(`+${points}`, at, combo > 1);
  }

  /** The ball was missed. True while there is still a ball to lose. */
  loseLife(): boolean {
    this.lives -= 1;
    // The pip that goes bursts first; the screen flashes red behind it.
    const pip = this.hud.lives.children[this.lives] as HTMLElement | undefined;
    if (pip) this.startCoroutine(this.flick(pip, 'losing', 0.18));
    this.startCoroutine(this.flick(this.hud.flash, 'on', 0.07));
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
    this.hud.introStage.textContent = `STAGE ${this.index + 1}`;
    this.hud.introName.textContent = this.game?.levelName ?? '';
    this.startCoroutine(this.sweep());
  }

  /** In from the right, spaced wide; held; out to the left. */
  private *sweep(): Generator<Yieldable> {
    const intro = this.hud.intro;
    intro.classList.remove('shown', 'leave');
    intro.classList.add('enter');
    yield new WaitForSecondsRealtime(0.2);
    intro.classList.remove('enter');
    intro.classList.add('shown');
    yield new WaitForSecondsRealtime(1.25);
    intro.classList.replace('shown', 'leave');
  }

  // --- motion: a class on, and off again ---------------------------------------------------

  /** Into place from where `from` holds it: placed there at once, then — a frame later — moved in. */
  private *arrive(element: HTMLElement, from: string): Generator<Yieldable> {
    element.classList.add(from);
    yield null;
    element.classList.remove(from);
  }

  /** On for `seconds`, then off: the CSS moves it there and back. */
  private *flick(element: HTMLElement, name: string, seconds: number): Generator<Yieldable> {
    element.classList.add(name);
    yield new WaitForSecondsRealtime(seconds);
    element.classList.remove(name);
  }

  /** On and off every `seconds`, for as long as the run lasts. */
  private *pulse(element: HTMLElement, name: string, seconds: number): Generator<Yieldable> {
    for (;;) {
      element.classList.toggle(name);
      yield new WaitForSecondsRealtime(seconds);
    }
  }

  // --- drawing ----------------------------------------------------------------------------

  redraw(): void {
    this.hud.score.textContent = String(this.score).padStart(5, '0');
    this.hud.level.textContent = `${this.index + 1}/${this.levels.length} · ${this.game?.levelName ?? ''}`;
    [...this.hud.lives.children].forEach((pip, i) => pip.classList.toggle('spent', i >= this.lives));

    this.hud.splash.classList.toggle('gone', this.game?.phase !== 'title');
    [...this.hud.lives.children].forEach((pip, i) => i >= this.lives || pip.classList.remove('losing'));
    const message = MESSAGES[this.game?.phase ?? 'ready'];
    this.hud.banner.classList.toggle('shown', message !== null);
    if (!message) return;
    this.hud.banner.classList.toggle('bad', message.mood === 'bad');
    this.hud.headline.textContent = message.headline;
    this.hud.hint.textContent = message.hint;
  }

  /** A number rising from a point of the world, then gone: CSS moves it, and it is taken out once it has. */
  private popup(text: string, at: Vector3, hot: boolean): void {
    const camera = this.camera;
    if (!camera) return;
    const screen = at.clone().project(camera);
    const label = clone(this.popupTemplate);
    label.classList.toggle('hot', hot);
    label.textContent = text;
    label.style.left = `${((screen.x + 1) / 2) * 100}%`;
    label.style.top = `${((1 - screen.y) / 2) * 100}%`;
    label.addEventListener('transitionend', (event) => event.propertyName === 'opacity' && label.remove());
    this.hud.popups.append(label);
    this.startCoroutine(this.arrive(label, 'start'));
  }
}

/** The word on a running bonus's chip. */
const LABELS: Record<Exclude<Bonus, 'none'>, string> = { laser: 'LASER', multi: '×3', wide: 'WIDE', slim: 'SLIM' };

/** What the banner says, or `null` where there is no banner. */
const MESSAGES: Record<GameState['phase'], { headline: string; hint: string; mood: string } | null> = {
  title: null,
  ready: null,
  playing: null,
  cleared: { headline: 'LEVEL CLEAR', hint: 'TAP TO CONTINUE', mood: 'good' },
  lost: { headline: 'GAME OVER', hint: 'TAP TO TRY AGAIN', mood: 'bad' },
  won: { headline: 'YOU WIN', hint: 'TAP TO PLAY AGAIN', mood: 'good' },
};

/** A copy of a `<template>`'s element — UI Toolkit's `VisualTreeAsset.Instantiate`. */
function clone(template: HTMLTemplateElement): HTMLElement {
  return template.content.firstElementChild!.cloneNode(true) as HTMLElement;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html has no #${id} — the HUD is the page's own HTML.`);
  return found;
}
