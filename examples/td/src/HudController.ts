import type { Vector3 } from 'three';
import { Behaviour, Tween, WaitForSeconds } from '@scenoco-three/core';
import { Game } from './Game';
import { LEVEL_ORDER } from './levels';
import { Sfx } from './Sfx';
import { WaveSpawner } from './WaveSpawner';
import { $, appear, clone, flick, shake, sweep } from './hud';

/**
 * What the player sees of the run: gold, lives and the wave on the HUD, numbers floating up out of the
 * map, a toast now and then, and the screen at the end. It only listens — to the `Game`'s events and
 * the `WaveSpawner`'s — and moves the page's elements between their classes, the CSS doing the motion.
 */
export class HudController extends Behaviour {
  override start() {
    const game = this.getComponent(Game)!;
    for (const id of ['title', 'won', 'lost', 'pause', 'banner']) $(id).classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('gold').textContent = String(game.gold);
    $('lives').textContent = String(game.lives);
    $('wave').textContent = '0';

    this.listen(game.onGold, (gold, change, at) => {
      $('gold').textContent = String(gold);
      flick($('gold-chip'), 'bump', 0.12);
      if (at && change > 0) this.pop(at, `+${change}`, 'coin');
    });
    this.listen(game.onLivesLost, (lives, lost, at) => {
      $('lives').textContent = String(lives);
      flick($('vignette'), 'flash', 0.05);
      // The lives chip reddens and shakes.
      flick($('lives-chip'), 'hurt', 0.45);
      shake($('lives-chip'));
      this.pop(at, `-${lost}`, 'hurt');
    });
    const spawner = this.getComponent(WaveSpawner);
    if (spawner) this.listen(spawner.onWaveStarted, (index, _of) => void ($('wave').textContent = String(index + 1)));
    this.listen(game.onWon, (stars) => this.startCoroutine(this.showWin(stars)));
    this.listen(game.onLost, () => {
      $('lost-text').textContent = `Wave ${spawner?.wave ?? 0} of ${game.spec.waves.length} broke through.`;
      appear('lost');
    });

    // The gold buttons' light sweeps across them for as long as the level runs.
    for (const shine of document.querySelectorAll<HTMLElement>('#ui .shine')) sweep(shine).setLink(this);
  }

  override onDestroy() {
    $('hud').classList.add('hidden');
  }

  /** A word at the bottom of the screen for a second: a bonus, a refusal. */
  toast(text: string) {
    $('toast-text').textContent = text;
    flick($('toast'), 'shown', 1.12);
  }

  /** Not enough gold: the button shakes, and says so. */
  refuse(el: HTMLElement) {
    shake(el);
    this.toast('Not enough gold');
    this.getComponent(Sfx)?.play('nope', 0.7);
  }

  /** Stars one by one, each with a chime. */
  private *showWin(stars: number) {
    const game = this.getComponent(Game)!;
    this.getComponent(Sfx)?.play('win');
    const last = LEVEL_ORDER.indexOf(game.level) === LEVEL_ORDER.length - 1;
    $('won-next').classList.toggle('hidden', last);
    $('won-text').textContent = last ? 'Every bastion stands. Well played!' : `${game.lives} of ${game.spec.lives} lives kept.`;
    const shown = [...$('won-stars').children] as HTMLElement[];
    shown.forEach((star) => star.classList.remove('show', 'got'));
    appear('won');
    for (let i = 0; i < 3; i++) {
      yield new WaitForSeconds(0.35);
      shown[i]!.classList.add('show');
      if (i < stars) {
        shown[i]!.classList.add('got');
        this.getComponent(Sfx)?.play('star', 0.8);
      }
    }
  }

  /** Floating text over a point in the world: up out of it and large, on up fading, then gone. */
  private pop(at: Vector3, text: string, kind: 'coin' | 'hurt') {
    const p = at.clone().setY(at.y + 1.4).project(this.camera);
    if (p.z > 1) return;
    const el = clone('pop');
    el.classList.toggle('hurt', kind === 'hurt');
    (el.querySelector('.say') as HTMLElement).textContent = text;
    if (kind === 'coin') el.append(Object.assign(document.createElement('div'), { className: 'icon coin' }));
    el.style.left = `${((p.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - p.y) / 2) * 100}%`;
    $('pops').appendChild(el);
    Tween.sequence()
      .appendCallback(() => el.classList.replace('start', 'mid'))
      .appendInterval(0.15)
      .appendCallback(() => el.classList.remove('mid'))
      .appendInterval(0.85)
      .appendCallback(() => el.remove())
      .setUpdate(true);
  }
}
