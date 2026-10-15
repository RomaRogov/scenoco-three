import { AudioListener } from 'three';
import { System, cameraOf } from '@scenoco-three/core';
import { hasWebAudio } from './AudioClip.js';

/**
 * The scene's ears and its master volume: made by the first `AudioSource` that starts.
 * `AudioMixer.volume = 0.5` halves everything — Unity's `AudioListener.volume`.
 *
 * In Unity the ears are an `AudioListener` on the main camera; here the listener follows whichever
 * camera draws the scene. Browsers refuse to start an `AudioContext` until the page has been
 * interacted with, so the first click or key press resumes it.
 */
export class AudioMixer extends System {
  /** Master volume, `0`..`1`. Scales every `AudioSource`. */
  static volume = 1;

  /** The three.js listener — the "ears". Null where there is no Web Audio. */
  get listener(): AudioListener | null {
    return this._listener;
  }

  private _listener: AudioListener | null = null;

  private attachedTo: unknown = null;
  private appliedVolume = 1;

  override awake(): void {
    if (!hasWebAudio()) return;
    this._listener = new AudioListener();
    this._listener.setMasterVolume(AudioMixer.volume);
    this.appliedVolume = AudioMixer.volume;
    window.addEventListener('pointerdown', this.resume);
    window.addEventListener('keydown', this.resume);
  }

  override update(): void {
    const listener = this.listener;
    if (!listener) return;

    // A load may bring another camera; checking costs one comparison a frame.
    const camera = cameraOf(this.runtime);
    if (camera && camera !== this.attachedTo) {
      camera.add(listener);
      this.attachedTo = camera;
    }

    if (AudioMixer.volume !== this.appliedVolume) {
      listener.setMasterVolume(AudioMixer.volume);
      this.appliedVolume = AudioMixer.volume;
    }
  }

  override onDestroy(): void {
    if (!this.listener) return;
    window.removeEventListener('pointerdown', this.resume);
    window.removeEventListener('keydown', this.resume);
    this.listener.removeFromParent();
    this._listener = null;
    this.attachedTo = null;
  }

  private resume = (): void => {
    const context = this.listener?.context;
    if (context?.state === 'suspended') void context.resume();
  };
}
