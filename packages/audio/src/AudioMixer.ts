import { AudioListener } from 'three';
import { System } from '@scenoco-three/core';
import { hasWebAudio } from './AudioClip.js';

/**
 * The scene's ears and its master volume.
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <AudioMixer volume="0.8" />
 *   </Systems>
 * </Scene>
 * ```
 *
 * Declaring it is optional: the first `<AudioSource>` calls `requireSystem` and gets one.
 * Declaring it only sets the master volume.
 *
 * In Unity the ears are an `AudioListener` component you put on the Main Camera — and every new
 * Unity scene already has one, so nobody thinks about it. This is that, made literal: the
 * listener is created here and parented to `scene.mainCamera` as soon as the scene names one.
 * It is a system rather than a component because there is exactly one per scene and it belongs
 * to no particular node, which is the line core already draws.
 *
 * It also handles the thing no component could do for itself: browsers refuse to start an
 * `AudioContext` until the user has interacted with the page, so the first click or key press
 * resumes it.
 */
export class AudioMixer extends System {
  /** Master volume, `0`..`1`. Scales every `AudioSource` in the scene. */
  volume = 1;

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
    this._listener.setMasterVolume(this.volume);
    this.appliedVolume = this.volume;
    window.addEventListener('pointerdown', this.resume);
    window.addEventListener('keydown', this.resume);
  }

  override update(): void {
    const listener = this.listener;
    if (!listener) return;

    // The camera is set during `onLoad`, which may be after the first source woke this up, and
    // a scene is free to swap it later. Checking here costs one reference comparison a frame and
    // means neither ordering has to be documented.
    const camera = this.scene.mainCamera;
    if (camera && camera !== this.attachedTo) {
      camera.add(listener);
      this.attachedTo = camera;
    }

    // Assigning `volume` is how a script changes it, so the change has to reach three.js
    // somewhere. Here, rather than behind a setter, keeps the field a plain field — which is
    // what makes it an attribute the compiler can read.
    if (this.volume !== this.appliedVolume) {
      listener.setMasterVolume(this.volume);
      this.appliedVolume = this.volume;
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
