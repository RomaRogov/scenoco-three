import { Behaviour, Event, Tween } from '@scenoco-three/core';

/** How many coins the player has, and the label that shows it: coins tell it, and it tells whoever listens. */
export class CoinCounter extends Behaviour {
  count = 0;
  readonly onCollected = new Event<[count: number]>();

  override start() {
    this.listen(this.onCollected, (count) => {
      const label = document.getElementById('coin-count');
      if (label) label.textContent = String(count);
      const card = document.getElementById('coins');
      if (!card) return;
      card.classList.add('bump');
      Tween.delayedCall(0.12, () => card.classList.remove('bump')).setLink(this);
    });
  }

  collect() {
    this.count++;
    this.onCollected.emit(this.count);
  }
}
