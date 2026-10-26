import { Behaviour, SceneManager } from '@scenoco-three/core';
import { LEVELS, LEVEL_ORDER, type LevelId } from './levels';
import { loadStars } from './progress';
import { route } from './routes';
import { Sfx } from './Sfx';
import { maps } from './ui';

const $ = (id: string) => document.getElementById(id)!;

/** The title screen: one card per level, its stars, locked until the one before is won. */
export class MenuController extends Behaviour {
  private cleanup: (() => void)[] = [];

  override start() {
    for (const id of ['hud', 'won', 'lost', 'pause', 'banner']) $(id).classList.add('hidden');
    $('title').classList.remove('hidden');
    const stars = loadStars();
    const list = $('levels');
    list.innerHTML = '';
    LEVEL_ORDER.forEach((id, i) => {
      const spec = LEVELS[id];
      const locked = i > 0 && !stars[LEVEL_ORDER[i - 1]!];
      const got = stars[id] ?? 0;
      const card = document.createElement('button');
      card.className = `level${locked ? ' locked' : ''}`;
      card.innerHTML = `
        <div class="map" style="background-image: url(${maps[id]})"></div>
        <div class="info"><b>${i + 1}. ${spec.name}</b><small>${spec.blurb}</small>
          <div class="stars">${[1, 2, 3].map((s) => `<img src="/ui/star.png" class="${s <= got ? '' : 'off'}" alt="" />`).join('')}</div></div>
        <div class="go"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></div>`;
      const onClick = () => (locked ? this.refuse(card) : this.play(id));
      card.addEventListener('click', onClick);
      this.cleanup.push(() => card.removeEventListener('click', onClick));
      list.appendChild(card);
    });
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
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }
}
