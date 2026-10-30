import { Behaviour, SceneManager, Screen } from '@scenoco-three/core';
import { $, appear, arrive, clone, loop, shake } from './hud';
import { LEVELS, LEVEL_ORDER, type LevelId } from './levels';
import { loadStars } from './progress';
import { route } from './routes';
import { Sfx } from './Sfx';

/** The title screen: one card per level, its stars, locked until the one before is won. */
export class MenuController extends Behaviour {
  private cleanup: (() => void)[] = [];

  override start() {
    for (const id of ['hud', 'won', 'lost', 'pause', 'banner']) $(id).classList.add('hidden');
    this.startCoroutine(appear('title'));
    // The logo bobs as long as the title is up.
    this.startCoroutine(loop($('logo'), 'up', 1.5));
    const stars = loadStars();
    const cards = LEVEL_ORDER.map((id, i) => {
      const spec = LEVELS[id];
      const locked = i > 0 && !stars[LEVEL_ORDER[i - 1]!];
      const got = stars[id] ?? 0;
      const card = clone('level');
      card.classList.toggle('locked', locked);
      (card.querySelector('.map') as HTMLElement).classList.add(id);
      (card.querySelector('.name') as HTMLElement).textContent = `${i + 1}. ${spec.name}`;
      (card.querySelector('.blurb') as HTMLElement).textContent = spec.blurb;
      card.querySelectorAll('.star').forEach((star, s) => star.classList.toggle('off', s + 1 > got));
      // One after another as the title comes up.
      card.style.transitionDelay = `${i * 0.08}s`;
      // Only a tap that began on the card: the finger that pressed Map is still down when this
      // menu appears, and a touch's click goes to whatever is under it when it lifts.
      let pressed = false;
      const onDown = () => (pressed = true);
      const onClick = () => {
        if (!pressed) return;
        pressed = false;
        if (locked) this.refuse(card);
        else this.play(id);
      };
      card.addEventListener('pointerdown', onDown);
      card.addEventListener('click', onClick);
      this.cleanup.push(() => {
        card.removeEventListener('pointerdown', onDown);
        card.removeEventListener('click', onClick);
      });
      return card;
    });
    $('levels').replaceChildren(...cards);
    this.startCoroutine(arrive(cards));
  }

  override update() {
    $('ui').classList.toggle('wide', Screen.width > Screen.height * 1.5);
  }

  override onDestroy() {
    for (const undo of this.cleanup) undo();
  }

  private play(id: LevelId) {
    this.getComponent(Sfx)?.play('click');
    $('title').classList.add('hidden');
    SceneManager.load(route(id));
  }

  private refuse(card: HTMLElement) {
    this.getComponent(Sfx)?.play('nope');
    this.startCoroutine(shake(card));
  }
}
