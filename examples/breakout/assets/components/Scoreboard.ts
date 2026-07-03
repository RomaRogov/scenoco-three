import { Component, component } from '@scenoco-three/core';

/**
 * Drives the Breakout HUD — the DOM overlay declared in `breakout.ui.html`.
 *
 * This is the whole pattern for HTML/CSS UI in SceNoCo: a normal component that
 * grabs its elements from `this.engine.overlay` (the `<div>` layered over the
 * canvas) with plain `querySelector`, and updates them with plain DOM. No
 * UI-specific API, no wrapper tags — the HTML is the view, this is the controller.
 * The `Ball` holds a reference to this component (`scoreboard="#ui"`) and calls
 * its methods as the game progresses, exactly like any other component reference.
 */
@component({ name: 'Scoreboard', description: 'Updates the DOM HUD (score, lives, win/lose banner)' })
export class Scoreboard extends Component {
  private scoreEl: HTMLElement | null = null;
  private livesEl: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private score = 0;

  override onLoad(): void {
    const ui = this.engine.overlay;
    this.scoreEl = ui.querySelector('#score');
    this.livesEl = ui.querySelector('#lives');
    this.bannerEl = ui.querySelector('#banner');
  }

  addPoints(points: number): void {
    this.score += points;
    if (this.scoreEl) this.scoreEl.textContent = String(this.score);
  }

  setLives(lives: number): void {
    if (this.livesEl) this.livesEl.textContent = String(Math.max(0, lives));
  }

  /** Show a centered message (win/lose); empty string hides it. */
  banner(text: string): void {
    if (!this.bannerEl) return;
    this.bannerEl.textContent = text;
    this.bannerEl.style.display = text ? 'flex' : 'none';
  }
}
