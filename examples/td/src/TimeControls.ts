import { Behaviour, Input, KeyCode, Time } from '@scenoco-three/core';
import { BuildController } from './BuildController';
import { Game } from './Game';
import { Sfx } from './Sfx';
import { $, appear } from './hud';

/** The speed and pause buttons, on Unity's `Time.timeScale`: 1×, 2×, 3×, and 0 while paused. */
export class TimeControls extends Behaviour {
  speed = 1;
  paused = false;

  override start() {
    $('speed-text').textContent = '1×';
    $('speed').classList.remove('on');
  }

  override update() {
    if (Input.getButtonDown('Speed')) this.toggleSpeed();
    if (Input.getButtonDown('Pause') || Input.getKeyDown(KeyCode.Escape)) this.setPaused(!this.paused);
    if (Input.getButtonDown('Resume')) this.setPaused(false);
  }

  private toggleSpeed() {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
    if (!this.paused) Time.timeScale = this.speed;
    $('speed-text').textContent = `${this.speed}×`;
    $('speed').classList.toggle('on', this.speed > 1);
    this.getComponent(Sfx)?.play('click', 0.6);
  }

  private setPaused(paused: boolean) {
    if (this.getComponent(Game)?.over) return;
    this.paused = paused;
    Time.timeScale = paused ? 0 : this.speed;
    if (!paused) return void $('pause').classList.add('hidden');
    appear('pause');
    this.getComponent(BuildController)?.select(null);
  }
}
