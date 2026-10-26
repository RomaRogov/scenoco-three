import { Behaviour, SceneManager } from '@scenoco-three/core';
import { EggController } from './EggController';
import { LevelController } from './LevelController';
import { Main } from './scenes/Main';

/** DOTween's easings for the page's animations. */
const OUT_BACK = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const IN_BACK = 'cubic-bezier(0.36, 0, 0.66, -0.56)';
const IN_EXPO = 'cubic-bezier(0.7, 0, 0.84, 0)';

const element = (id: string) => document.getElementById(id) as HTMLElement;
/** One of Unity's canvas units, in CSS pixels now. */
const unit = () => parseFloat(getComputedStyle(element('frame')).height) / 1920;

/**
 * The title, the play button, the star counter and the fade — the Unity game's `UIController`, on
 * the page's own elements. The page outlives scene loads, so each load puts it back as it was.
 */
export class UIController extends Behaviour {
  private gameStarted = false;

  static gameOver(_lose: boolean): void {
    const fade = element('fade');
    fade.classList.remove('hidden');
    fade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 300, fill: 'forwards' }).onfinish = () => {
      // Unity reloads the active scene: everything starts again, the page and the music stay.
      SceneManager.load(Main);
    };
  }

  static starsChanged(): void {
    element('count').textContent = `${LevelController.starsCollected}/${LevelController.starsOnLevel}`;
    element('stars').animate([{ scale: 1 }, { scale: 1.2 }, { scale: 0.9 }, { scale: 1 }], { duration: 300 });
  }

  override start() {
    const u = unit();
    const fade = element('fade');
    fade.classList.remove('hidden');
    fade.getAnimations().forEach((a) => a.cancel());
    fade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 100, fill: 'forwards' }).onfinish = () => fade.classList.add('hidden');

    const title = element('title');
    title.getAnimations().forEach((a) => a.cancel());
    title.animate([{ translate: `0 ${-600 * u}px` }, { translate: '0 0' }], { duration: 400, delay: 300, easing: OUT_BACK, fill: 'both' });

    const play = element('play') as HTMLButtonElement;
    play.getAnimations().forEach((a) => a.cancel());
    play.disabled = false;
    play.animate([{ translate: `0 ${800 * u}px` }, { translate: '0 0' }], { duration: 300, delay: 200, easing: OUT_BACK, fill: 'both' });
    play.onclick = () => this.startGame();

    const stars = element('stars');
    stars.getAnimations().forEach((a) => a.cancel());
    element('level').textContent = `LEVEL ${LevelController.currentLevel}`;
    element('count').textContent = String(LevelController.starsOverall);
  }

  private startGame() {
    if (this.gameStarted) return;
    this.gameStarted = true;
    const u = unit();
    const play = element('play') as HTMLButtonElement;
    play.disabled = true;
    element('title').animate([{ translate: '0 0' }, { translate: `0 ${-600 * u}px` }], { duration: 300, delay: 100, easing: IN_EXPO, fill: 'forwards' });
    const stars = element('stars');
    stars.animate([{ scale: 1 }, { scale: 0 }], { duration: 300, easing: IN_BACK, fill: 'forwards' }).onfinish = () => {
      element('count').textContent = `${LevelController.starsCollected}/${LevelController.starsOnLevel}`;
      stars.animate([{ scale: 1, translate: `0 ${-300 * u}px` }, { scale: 1, translate: '0 0' }], { duration: 300, delay: 300, easing: OUT_BACK, fill: 'both' });
    };
    play.animate([{ translate: '0 0' }, { translate: `0 ${800 * u}px` }], { duration: 300, easing: IN_BACK, fill: 'forwards' }).onfinish = () =>
      EggController.startGame();
  }
}
