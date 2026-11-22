import { Color } from 'three';
import { Behaviour, Ease, Tween, findObjectOfType } from '@scenoco-three/core';
import { ChromaticAberration, Vignette } from '@scenoco-three/postprocessing';
import { Progress } from './Progress.js';

/**
 * The picture answers the game: a hit fringes it with colour for a moment, harder the harder the hit,
 * and a lost ball floods the corners red before they settle back. Tweens on the Volume's own effects,
 * on this node — every field is read each frame, so it can be tweened like a transform.
 */
export class HitLook extends Behaviour {
  /** The vignette's colour when a ball is lost. */
  lostColor = new Color('#ff1a3c');

  private restIntensity = 0;
  private readonly restColor = new Color();

  override start(): void {
    const vignette = this.getComponent(Vignette)!;
    this.restIntensity = vignette.intensity;
    this.restColor.copy(vignette.color);
    const progress = findObjectOfType(Progress);
    if (!progress) return;
    // Each level has its own GameState: its impacts are listened to as it loads.
    this.listen(progress.onLevelLoaded, (game) => this.listen(game.impact, (strength) => this.fringe(strength)));
    this.listen(progress.onLifeLost, () => this.lost());
  }

  /** Colour fringes that die away over a third of a second. */
  private fringe(strength: number): void {
    const effect = this.getComponent(ChromaticAberration)!;
    Tween.kill(effect);
    effect.intensity = Math.min(1, 0.2 + strength * 0.6);
    Tween.to(() => effect.intensity, (v) => (effect.intensity = v), 0, 0.35).setEase(Ease.OutCubic).setTarget(effect).setLink(this);
  }

  /** The corners red and close in, then back to how the scene set them. */
  private lost(): void {
    const vignette = this.getComponent(Vignette)!;
    Tween.kill(vignette);
    vignette.color.copy(this.lostColor);
    vignette.intensity = 0.6;
    Tween.sequence()
      .appendInterval(0.15)
      .append(Tween.to(() => vignette.intensity, (v) => (vignette.intensity = v), this.restIntensity, 0.7).setEase(Ease.OutQuad))
      .join(Tween.to(() => vignette.color, (c) => vignette.color.copy(c), this.restColor, 0.7))
      .setTarget(vignette)
      .setLink(this);
  }
}
