import { Component } from '@scenoco-three/core';
import type { Text } from '@scenoco-three/ui';
import { Carrier } from './Carrier.js';
import { Run } from './Run.js';

/** Seconds left, what has been delivered, what is on your back, and the banner at the end. */
export class Hud extends Component {
  timeText!: Text;
  scoreText!: Text;
  carryText!: Text;
  banner!: Text;
  /** The player, for the carried count. */
  carrier!: Carrier;

  private run!: Run;

  override awake(): void {
    this.run = this.requireSystem(Run);
  }

  override update(): void {
    this.timeText.text = `${Math.ceil(this.run.remaining)}`;
    this.scoreText.text = `${this.run.delivered} / ${this.run.quota}`;
    this.carryText.text = this.carrier.count > 0 ? `carrying ${this.carrier.count}` : '';
    // ASCII only: the default font draws a missing glyph as a tofu box.
    this.banner.text =
      this.run.phase === 'won' ? 'DELIVERED!' : this.run.phase === 'lost' ? 'OUT OF TIME' : '';
  }
}
