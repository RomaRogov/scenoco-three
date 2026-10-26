import { Behaviour, Time } from '@scenoco-three/core';
import { AudioSource, sharedClip } from '@scenoco-three/audio';

import arrow from './sounds/arrow.wav?url';
import boom from './sounds/boom.wav?url';
import build from './sounds/build.wav?url';
import cannon from './sounds/cannon.wav?url';
import click from './sounds/click.wav?url';
import coin from './sounds/coin.wav?url';
import death from './sounds/death.wav?url';
import frost from './sounds/frost.wav?url';
import hit from './sounds/hit.wav?url';
import horn from './sounds/horn.wav?url';
import leak from './sounds/leak.wav?url';
import lose from './sounds/lose.wav?url';
import magic from './sounds/magic.wav?url';
import nope from './sounds/nope.wav?url';
import sell from './sounds/sell.wav?url';
import star from './sounds/star.wav?url';
import upgrade from './sounds/upgrade.wav?url';
import win from './sounds/win.wav?url';

/** Synthesised by tools/sfx.py. */
export const sounds = {
  arrow: sharedClip(arrow), boom: sharedClip(boom), build: sharedClip(build), cannon: sharedClip(cannon),
  click: sharedClip(click), coin: sharedClip(coin), death: sharedClip(death), frost: sharedClip(frost),
  hit: sharedClip(hit), horn: sharedClip(horn), leak: sharedClip(leak), lose: sharedClip(lose),
  magic: sharedClip(magic), nope: sharedClip(nope), sell: sharedClip(sell), star: sharedClip(star),
  upgrade: sharedClip(upgrade), win: sharedClip(win),
};

export type SoundName = keyof typeof sounds;

/**
 * The game's one-shot sounds, through the `AudioSource` beside it. The same sound twice within
 * `spacing` seconds plays once: a volley of twenty arrows is one twang, not a roar.
 */
export class Sfx extends Behaviour {
  spacing = 0.06;

  private last = new Map<SoundName, number>();

  play(name: SoundName, volume = 1) {
    const now = Time.unscaledTime;
    if (now - (this.last.get(name) ?? -1) < this.spacing) return;
    this.last.set(name, now);
    this.getComponent(AudioSource)?.playOneShot(sounds[name], volume);
  }
}
