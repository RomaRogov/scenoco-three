import { Component } from '@scenoco-three/core';
import type { Text } from '@scenoco-three/ui';
import { Round } from './Round.js';

/**
 * The readout: seconds left, score, and the banner at the end.
 *
 * Wired by `#id` in the document, the way `Progress` wires the breakout HUD. It reads the round
 * rather than being told, because a HUD that is pushed to has to be pushed to from everywhere.
 */
export class Hud extends Component {
  timeText!: Text;
  scoreText!: Text;
  banner!: Text;

  private round!: Round;

  override awake(): void {
    this.round = this.requireSystem(Round);
  }

  override update(): void {
    this.timeText.text = `${Math.ceil(this.round.remaining)}`;
    this.scoreText.text = `${this.round.score} / ${this.round.target}`;
    // ASCII only: the default font has no glyph for a middle dot, and a missing one draws as a
    // tofu box — the same reason breakout's lives are pips.
    this.banner.text =
      this.round.phase === 'won' ? 'NICE!' : this.round.phase === 'lost' ? 'TRY AGAIN' : '';
  }
}
