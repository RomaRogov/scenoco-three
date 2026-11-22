import { Color, Fog, type DirectionalLight } from 'three';
import { Behaviour, Ease, Tween } from '@scenoco-three/core';

/**
 * Day and night, on the sun: `toggle()` — sent by name from the pressure plate — fades its light,
 * and the sky and the fog of the scene it is in (`node.scene`, Unity's `gameObject.scene`).
 */
export class DayNight extends Behaviour<DirectionalLight> {
  daySky = new Color('#bcd9ee');
  nightSky = new Color('#0d1530');
  dayLight = 2.2;
  nightLight = 0.25;
  /** Seconds a change takes. */
  fade = 1.2;

  private night = false;

  /** Called by `sendMessage(node, 'toggle')`. */
  toggle() {
    const scene = this.node.scene;
    if (!scene) return;
    this.night = !this.night;
    const sky = this.night ? this.nightSky : this.daySky;
    this.node.doIntensity(this.night ? this.nightLight : this.dayLight, this.fade).setEase(Ease.InOutSine);
    if (scene.background instanceof Color) {
      const background = scene.background;
      Tween.to(() => background, (c) => background.copy(c), sky, this.fade).setEase(Ease.InOutSine).setLink(this);
    }
    if (scene.fog instanceof Fog) {
      const fog = scene.fog.color;
      Tween.to(() => fog, (c) => fog.copy(c), sky, this.fade).setEase(Ease.InOutSine).setLink(this);
    }
  }
}
