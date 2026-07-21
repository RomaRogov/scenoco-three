import { Component, component, property, ValueType } from '@scenoco-three/core';
import type { Container, Text } from '@scenoco-three/ui';

/**
 * Drives the Breakout HUD — the in-canvas `<Fullscreen>` UI declared in the
 * scene itself.
 *
 * This is the whole pattern for UI in SceNoCo: the elements are ordinary scene
 * nodes (`<Text id="score">`), a normal component references them with node
 * properties, and updates them with the plain pmndrs-uikit API
 * (`setProperties`). The `Ball` holds a reference to this component
 * (`scoreboard="#hud"`) and calls its methods as the game progresses, exactly
 * like any other component reference.
 */
@component({ name: 'Scoreboard', description: 'Updates the in-canvas HUD (score, lives, win/lose banner)' })
export class Scoreboard extends Component {
  @property({ type: ValueType.Node, description: 'Text element showing the score value' })
  scoreLabel: Text | null = null;

  @property({ type: ValueType.Node, description: 'Text element showing the lives value' })
  livesLabel: Text | null = null;

  @property({ type: ValueType.Node, description: 'Centered banner container (win/lose message)' })
  bannerBox: Container | null = null;

  @property({ type: ValueType.Node, description: 'Text element inside the banner' })
  bannerLabel: Text | null = null;

  private score = 0;

  addPoints(points: number): void {
    this.score += points;
    this.scoreLabel?.setProperties({ text: String(this.score) });
  }

  setLives(lives: number): void {
    this.livesLabel?.setProperties({ text: String(Math.max(0, lives)) });
  }

  /** Show a centered message (win/lose); empty string hides it. */
  banner(text: string): void {
    this.bannerLabel?.setProperties({ text });
    this.bannerBox?.setProperties({ display: text ? 'flex' : 'none' });
  }
}
