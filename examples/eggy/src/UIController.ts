import { Behaviour, SceneManager, type Yieldable } from '@scenoco-three/core';
import { EggController } from './EggController';
import { LevelController } from './LevelController';
import { Main } from './scenes/Main';

const element = (id: string) => document.getElementById(id) as HTMLElement;

/** Run `then` once `el` has finished its transition — UI Toolkit's `TransitionEndEvent`. */
function afterTransition(el: HTMLElement, then: () => void): void {
  el.addEventListener('transitionend', () => then(), { once: true });
}

/**
 * The title, the play button, the star counter and the fade — the Unity game's `UIController`, on
 * the page's own elements. Its DOTween moves are the page's transitions: an element enters as the
 * class that held it off screen is taken away, and leaves as one is put back. The page outlives scene
 * loads, so each load puts it back as it was.
 */
export class UIController extends Behaviour {
  private gameStarted = false;
  private title!: HTMLElement;
  private play!: HTMLButtonElement;
  private stars!: HTMLElement;
  private count!: HTMLElement;
  private fade!: HTMLElement;

  static gameOver(_lose: boolean): void {
    const fade = element('fade');
    fade.classList.add('shut');
    // Unity reloads the active scene: everything starts again, the page and the music stay.
    afterTransition(fade, () => SceneManager.load(Main));
  }

  static starsChanged(): void {
    element('count').textContent = `${LevelController.starsCollected}/${LevelController.starsOnLevel}`;
    const stars = element('stars');
    stars.classList.add('bump');
    afterTransition(stars, () => stars.classList.remove('bump'));
  }

  override awake() {
    this.title = element('title');
    this.play = element('play') as HTMLButtonElement;
    this.stars = element('stars');
    this.count = element('count');
    this.fade = element('fade');
  }

  override start() {
    element('level').textContent = `LEVEL ${LevelController.currentLevel}`;
    this.count.textContent = String(LevelController.starsOverall);
    this.play.disabled = false;
    this.play.onclick = () => this.startGame();
    this.startCoroutine(this.enter());
  }

  /** In from where the last game left them: placed off screen at once, then moved in. */
  private *enter(): Generator<Yieldable> {
    for (const el of [this.title, this.play]) el.classList.add('instant', 'gone');
    this.stars.classList.remove('shrunk', 'raised', 'bump');
    yield null; // a frame, so the page has drawn them off screen before they move
    for (const el of [this.title, this.play]) el.classList.remove('instant', 'gone');
    this.fade.classList.remove('shut');
  }

  private startGame() {
    if (this.gameStarted) return;
    this.gameStarted = true;
    this.play.disabled = true;
    this.title.classList.add('gone');
    this.play.classList.add('gone');
    afterTransition(this.play, () => EggController.startGame());
    this.stars.classList.add('shrunk');
    afterTransition(this.stars, () => this.startCoroutine(this.showLevelStars()));
  }

  /** The counter comes back down from above, now counting this level's stars. */
  private *showLevelStars(): Generator<Yieldable> {
    this.count.textContent = `${LevelController.starsCollected}/${LevelController.starsOnLevel}`;
    this.stars.classList.add('instant', 'raised');
    this.stars.classList.remove('shrunk');
    yield null;
    this.stars.classList.remove('instant', 'raised');
  }
}
