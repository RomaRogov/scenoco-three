import { Easing, Group, Tween } from 'three/addons/libs/tween.module.js';
import { Component, Tweens } from '@scenoco-three/core';

/**
 * Spins, and bobs up and down for ever — the two things the old `<Tween>` component did, in the
 * shape that replaced it.
 *
 * The spin is arithmetic, so it is arithmetic: one line in `update`, no library and no
 * component to configure. The bob eases and reverses, which is what a tween library is for — and
 * the library is [tween.js](https://github.com/tweenjs/tween.js), which three.js ships in its own
 * addons, so it costs no dependency.
 *
 * `Tweens` is what makes it behave: the tween runs on the engine's clock, so `Time.timeScale`
 * pauses it and the editor's frame-step steps it. Started any other way it would run on
 * wall-clock time and keep going through a paused game.
 */
export class Hover extends Component {
  /** Degrees per second. */
  spin = 90;
  /** How far it rises, and how long one rise takes. */
  height = 1.5;
  duration = 1.6;

  private readonly tweens = new Group();
  private runner!: Tweens;

  override awake(): void {
    this.runner = this.requireSystem(Tweens).track(this.tweens);
  }

  override start(): void {
    const from = this.object3D.position.clone();
    this.runner.play(
      new Tween(this.object3D.position, this.tweens)
        .to({ y: from.y + this.height }, this.duration * 1000)
        .easing(Easing.Sinusoidal.InOut)
        .yoyo(true)
        .repeat(Infinity),
    );
  }

  override update(deltaTime: number): void {
    this.object3D.eulerAngles = this.object3D.eulerAngles.setY(
      this.object3D.eulerAngles.y + this.spin * deltaTime,
    );
  }

  override onDestroy(): void {
    this.tweens.removeAll();
    this.runner?.untrack(this.tweens);
  }
}
