import type { Object3D } from 'three';
import { Component, component, property, ValueType, type PointerEventData } from '@scenoco-three/core';
import type { Container, Text } from '@scenoco-three/ui';

/**
 * Drives the in-canvas HUD (score, coins, best, game-over panel + restart) —
 * the elements are scene nodes (`<Text id="score">` under the `<Fullscreen>`),
 * referenced here as node properties and updated with the plain pmndrs-uikit
 * API (`setProperties`). `PlayerController` holds a reference to this and calls
 * its methods; this component holds no reference back (one-directional).
 *
 * The RESTART button shows the whole UI-interaction pattern: it is just a
 * `<Container id="restartBtn">` — a click on it (or its label) bubbles up to
 * this component's `onPointerClick`, which checks the hit element's ancestry.
 */
@component({ name: 'Hud', description: 'Drives the in-canvas HUD (score, coins, game-over panel + restart).' })
export class Hud extends Component {
  @property({ type: ValueType.Node, description: 'Text element showing the score' })
  scoreLabel: Text | null = null;

  @property({ type: ValueType.Node, description: 'Text element showing the best score' })
  bestLabel: Text | null = null;

  @property({ type: ValueType.Node, description: 'Text element showing the coin count' })
  coinsLabel: Text | null = null;

  @property({ type: ValueType.Node, description: 'Game-over panel container (hidden until a crash)' })
  panel: Container | null = null;

  @property({ type: ValueType.Node, description: 'Text element on the game-over panel (final score line)' })
  finalScoreLabel: Text | null = null;

  @property({ type: ValueType.Node, description: 'Restart button container on the game-over panel' })
  restartButton: Container | null = null;

  private over = false;

  override onLoad(): void {
    const best = Number(localStorage.getItem('subway-best') ?? 0);
    this.bestLabel?.setProperties({ text: String(best) });
  }

  /** A click anywhere bubbles here; restart when it landed on the button. */
  override onPointerClick(event: PointerEventData): void {
    if (!this.over || !this.restartButton) return;
    for (let o: Object3D | null = event.object; o; o = o.parent) {
      if (o === this.restartButton) {
        this.panel?.setProperties({ display: 'none' });
        // main.ts owns the engine + bundle; a full loadScene() is a clean reset.
        window.dispatchEvent(new CustomEvent('scenoco:restart'));
        return;
      }
    }
  }

  setScore(score: number): void {
    this.scoreLabel?.setProperties({ text: String(score) });
  }

  setCoins(coins: number): void {
    this.coinsLabel?.setProperties({ text: String(coins) });
  }

  gameOver(score: number, coins: number): void {
    const best = Math.max(score, Number(localStorage.getItem('subway-best') ?? 0));
    localStorage.setItem('subway-best', String(best));
    this.bestLabel?.setProperties({ text: String(best) });
    this.finalScoreLabel?.setProperties({ text: `Score ${score} - ${coins} coins` });
    this.panel?.setProperties({ display: 'flex' });
    this.over = true;
  }
}
