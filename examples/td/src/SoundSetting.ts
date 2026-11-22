import { AudioMixer } from '@scenoco-three/audio';
import { Behaviour, Input, PlayerPrefs } from '@scenoco-three/core';
import { $ } from './hud';

/**
 * Sound on or off, kept for the next visit: `AudioMixer.volume`, the master volume every source plays
 * under, from PlayerPrefs — set as the scene starts, and flipped by the pause menu's Sound button.
 */
export class SoundSetting extends Behaviour {
  override start() {
    this.apply(PlayerPrefs.getInt('sound', 1) === 1);
  }

  override update() {
    if (Input.getButtonDown('Sound')) this.apply(AudioMixer.volume === 0);
  }

  private apply(on: boolean) {
    AudioMixer.volume = on ? 1 : 0;
    PlayerPrefs.setInt('sound', on ? 1 : 0);
    $('sound-state').textContent = on ? 'On' : 'Off';
  }
}
