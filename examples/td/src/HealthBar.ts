import type { Sprite } from 'three';
import { Behaviour } from '@scenoco-three/core';

/** A bar over an enemy's head: hidden at full health, its fill shrinking from the right. */
export class HealthBar extends Behaviour {
  fill: Sprite | null = null;
  width = 0.9;

  private shown = 1;
  private target = 1;

  set(value: number) {
    this.target = Math.max(0, Math.min(1, value));
  }

  override awake() {
    this.node.visible = false;
  }

  override update(dt: number) {
    const fill = this.fill;
    if (!fill) return;
    // Eases down, so a hit reads as a hit rather than a flicker.
    this.shown += (this.target - this.shown) * Math.min(1, dt * 12);
    const share = Math.max(0.0001, this.shown);
    fill.scale.x = this.width * share;
    // Pinned at the bar's left edge in screen space. A sprite faces the camera, but a position
    // offset would be in the enemy's space, and it turns along the path: the fill would slide off
    // its background. The anchor (`center`) is applied after billboarding, so it stays put.
    fill.center.x = 0.5 / share;
    this.node.visible = this.target < 0.999;
  }
}

