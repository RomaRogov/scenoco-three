import type { Vector3 } from 'three';
import { Behaviour, Screen, Tween, findObjectOfType } from '@scenoco-three/core';
import type { Bonus } from './bonus.js';
import type { GameState } from './GameState.js';
import { Paddle } from './Paddle.js';
import { Progress } from './Progress.js';

/**
 * The run as the player sees it, in the page's own HTML (`index.html`): the score, the level and the
 * lives on the bar, each brick's points floating up from where it broke, the running bonuses' timers,
 * and the banner between rounds — a `data-button="Continue"`, which `Input.getButtonDown` reads like a key.
 *
 * Nothing changes with a cut: a level change fades the screen to black and back, a stage opens with
 * its name, and a lost ball flashes the screen red and takes its pip away. The motion is the page's
 * CSS transitions; this only says when, by putting a class on and taking it off — what a port to UI
 * Toolkit does with the same USS. It reads `Progress` and listens to its events; it decides nothing.
 */
export class RunHud extends Behaviour {
  private progress!: Progress;
  private paddle: Paddle | null = null;
  /** What the bar and the banner showed last: redrawn only when it changes. */
  private drawn = '';
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
    this.progress = this.getComponent(Progress)!;
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
    const progress = this.progress;
    this.listen(progress.onLevelLoaded, () => {
      this.paddle = findObjectOfType(Paddle);
      this.hud.fade.classList.remove('shut');
    });
    this.listen(progress.onStageStarted, (stage) => {
      this.hud.bar.classList.add('shown');
      this.introduce(stage, progress.game);
    });
    this.listen(progress.onScored, (points, at, hot) => {
      this.flick(this.hud.score, 'bump', 0.09);
      this.popup(`+${points}`, at, hot);
    });
    this.listen(progress.onLifeLost, (lives) => {
      // The pip that goes bursts first; the screen flashes red behind it.
      const pip = this.hud.lives.children[lives] as HTMLElement | undefined;
      if (pip) this.flick(pip, 'losing', 0.18);
      this.flick(this.hud.flash, 'on', 0.07);
    });
    this.listen(progress.onLeaving, () => this.hud.fade.classList.add('shut'));

    // The splash's title arrives; PLAY pulses and the banner's hint blinks for as long as the run lasts.
    this.arrive(this.hud.title, 'arriving');
    this.pulse(this.hud.playGlow, 'bright', 0.8);
    this.pulse(this.hud.hint, 'dim', 0.6);
  }

  /** Every frame, after the game has moved: what changed is drawn again, and what runs down runs down. */
  override lateUpdate(): void {
    // A phone held upright gets the narrower sizes: UI Toolkit has no media queries.
    this.hud.ui.classList.toggle('portrait', Screen.height > Screen.width);
    const game = this.progress.game;
    const now = [this.progress.score, this.progress.lives, this.progress.stage, game?.phase, game?.levelName].join();
    if (now !== this.drawn) {
      this.drawn = now;
      this.redraw(game);
    }
    this.drawCombo(game?.combo ?? 0);
    this.drawEffects();
  }

  private redraw(game: GameState | null): void {
    const { score, lives, stage, levels } = this.progress;
    this.hud.score.textContent = String(score).padStart(5, '0');
    this.hud.level.textContent = `${stage + 1}/${levels.length} · ${game?.levelName ?? ''}`;
    [...this.hud.lives.children].forEach((pip, i) => {
      pip.classList.toggle('spent', i >= lives);
      if (i < lives) pip.classList.remove('losing');
    });
    this.hud.splash.classList.toggle('gone', game?.phase !== 'title');
    const message = MESSAGES[game?.phase ?? 'ready'];
    this.hud.banner.classList.toggle('shown', message !== null);
    if (!message) return;
    this.hud.banner.classList.toggle('bad', message.mood === 'bad');
    this.hud.headline.textContent = message.headline;
    this.hud.hint.textContent = message.hint;
  }

  private drawCombo(combo: number): void {
    if (combo === this.drawnCombo) return;
    this.drawnCombo = combo;
    this.hud.combo.textContent = combo > 1 ? `COMBO ×${combo}` : '';
    if (combo > 1) this.flick(this.hud.combo, 'bump', 0.09);
  }

  /** A chip for each running bonus, its timer shrinking as it wears off. */
  private drawEffects(): void {
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
        if (!this.shownBonuses.has(e.bonus)) this.arrive(chip, 'new');
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

  /** The stage's number and name, across the screen for a moment as it opens: in from the right, held, out to the left. */
  private introduce(stage: number, game: GameState | null): void {
    this.hud.introStage.textContent = `STAGE ${stage + 1}`;
    this.hud.introName.textContent = game?.levelName ?? '';
    const intro = this.hud.intro;
    intro.classList.remove('shown', 'leave');
    intro.classList.add('enter');
    this.after(0.2, () => {
      intro.classList.remove('enter');
      intro.classList.add('shown');
    });
    this.after(1.45, () => intro.classList.replace('shown', 'leave'));
  }

  /** A number rising from a point of the world, then gone: CSS moves it, and it is taken out once it has. */
  private popup(text: string, at: Vector3, hot: boolean): void {
    const screen = at.clone().project(this.camera);
    const label = clone(this.popupTemplate);
    label.classList.toggle('hot', hot);
    label.textContent = text;
    label.style.left = `${((screen.x + 1) / 2) * 100}%`;
    label.style.top = `${((1 - screen.y) / 2) * 100}%`;
    label.addEventListener('transitionend', (event) => event.propertyName === 'opacity' && label.remove());
    this.hud.popups.append(label);
    this.arrive(label, 'start');
  }

  // --- motion: a class on, and off again, on real time: the HUD moves during a pause ------

  private after(seconds: number, fn: () => void) {
    return Tween.delayedCall(seconds, fn).setUpdate(true).setLink(this);
  }

  /** Into place from where `from` holds it: placed there at once, then — a frame later — moved in. */
  private arrive(element: HTMLElement, from: string) {
    element.classList.add(from);
    this.after(0, () => element.classList.remove(from));
  }

  /** On for `seconds`, then off: the CSS moves it there and back. */
  private flick(element: HTMLElement, name: string, seconds: number) {
    element.classList.add(name);
    this.after(seconds, () => element.classList.remove(name));
  }

  /** On and off every `seconds`, for as long as the run lasts. */
  private pulse(element: HTMLElement, name: string, seconds: number) {
    Tween.sequence()
      .appendCallback(() => element.classList.toggle(name))
      .appendInterval(seconds)
      .setLoops(-1)
      .setUpdate(true)
      .setLink(this);
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
