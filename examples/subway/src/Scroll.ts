import { Behaviour, destroy } from '@scenoco-three/core';
import { Game, getGame } from './Game';

/** The world runs toward the player: moves its node along +z at the game's speed. */
export class Scroll extends Behaviour {
  killZ = 16;
  private game: Game | null = null;

  start() {
    this.game = getGame();
  }

  update(dt: number) {
    if (!this.game) return;
    const p = this.node.position;
    p.z += this.game.speed * dt;
    if (p.z > this.killZ) destroy(this.node);
  }
}
