import { Audio, PositionalAudio } from 'three';
import { Behaviour, service } from '@scenoco-three/core';
import type { AudioClip } from './AudioClip.js';
import { AudioMixer } from './AudioMixer.js';

/**
 * Plays an {@link AudioClip} — Unity's `AudioSource`, field for field.
 *
 * ```tsx
 * <Group position={[4, 0, 0]}>
 *   <AudioSource clip={sounds.engine} loop spatial minDistance={2} />
 * </Group>
 * ```
 *
 * A clip is made in a `.ts` module — `export const engine = sharedClip(engineUrl)` — and loaded
 * before the scene runs (`await loadAssets(engine)`), so `play()` is instant. Where there is no Web Audio — a test, a server render —
 * every method is a no-op and `isPlaying` is false, so a scene with sound in it still runs.
 */
export class AudioSource extends Behaviour {
  /** The sound to play. */
  clip!: AudioClip;

  /** Start playing as soon as the component starts. Unity's `playOnAwake`. */
  playOnAwake = true;
  /** Repeat forever. */
  loop = false;
  /** Volume, `0`..`1`, on top of the mixer's master volume. */
  volume = 1;
  /** Playback speed, and with it pitch. `1` is the recorded speed. */
  pitch = 1;

  /**
   * Play in 3D, attenuating with distance from the listener.
   *
   * Unity spells this `spatialBlend`, a slider from 2D to 3D. Web Audio has no crossfade between
   * the two — a source is routed through a panner or it is not — so this is the honest on/off.
   */
  spatial = false;
  /** 3D only: the distance within which the sound is at full volume. Unity's `minDistance`. */
  minDistance = 1;
  /** 3D only: the distance past which it stops getting quieter. */
  maxDistance = 10_000;

  /** The live three.js audio node. Null before `start`, and where there is no Web Audio. */
  get audio(): Audio | PositionalAudio | null {
    return this._audio;
  }

  private _audio: Audio | PositionalAudio | null = null;

  private mixer: AudioMixer | null = null;

  // --- lifecycle -------------------------------------------------------------------------

  override start(): void {
    // Checked before anything else, and before the Web Audio guard below: a missing clip is a
    // mistake in the scene, so it has to be reported wherever the scene runs — including the
    // headless test where nothing would ever have played anyway.
    if (!this.clip) {
      console.error(
        '[scenoco] AudioSource has no clip. Give it one made with sharedClip: ' +
          '<AudioSource clip={sounds.engine} />',
      );
      return;
    }

    // `start`, not `awake`: this reaches another component's work — the mixer's listener — and
    // that is exactly the line between the two hooks.
    this.mixer = service(this.node, AudioMixer);
    const listener = this.mixer.listener;
    if (!listener) return; // no Web Audio; every method below is a no-op

    const audio = this.spatial ? new PositionalAudio(listener) : new Audio(listener);
    if (audio instanceof PositionalAudio) {
      audio.setRefDistance(this.minDistance);
      audio.setMaxDistance(this.maxDistance);
      // A positional source is heard from where its node is, so it hangs under the node.
      this.node.add(audio);
    }
    audio.setLoop(this.loop);
    audio.setVolume(this.volume);
    audio.setPlaybackRate(this.pitch);
    this._audio = audio;

    if (this.playOnAwake) this.play();
  }

  override onDisable(): void {
    // A disabled source goes quiet, the way a disabled renderer stops drawing.
    this.stop();
  }

  override onDestroy(): void {
    const audio = this.audio;
    if (!audio) return;
    if (audio.isPlaying) audio.stop();
    audio.disconnect();
    audio.removeFromParent();
    this._audio = null;
    this.mixer = null;
  }

  // --- playback --------------------------------------------------------------------------

  /** True while the clip is sounding. */
  get isPlaying(): boolean {
    return this.audio?.isPlaying ?? false;
  }

  /** Play from the start. Silently does nothing until the clip has loaded. */
  play(): void {
    const buffer = this.buffer();
    if (!buffer || !this.audio) return;
    if (this.audio.isPlaying) this.audio.stop();
    this.audio.setBuffer(buffer);
    this.audio.play();
  }

  /** Stop, and rewind to the start. */
  stop(): void {
    if (this.audio?.isPlaying) this.audio.stop();
  }

  /** Stop, keeping the position, so `play()` would resume from here. */
  pause(): void {
    if (this.audio?.isPlaying) this.audio.pause();
  }

  /**
   * Fire a one-off that overlaps whatever is already playing — Unity's `PlayOneShot`.
   *
   * This is the one to reach for on a footstep or a hit: calling `play()` repeatedly cuts each
   * sound off with the next.
   *
   * Defaults to this source's own clip, and takes another to play a variation through the same
   * settings.
   */
  playOneShot(clip: AudioClip = this.clip, volumeScale = 1): void {
    const listener = this.mixer?.listener;
    const buffer = clip?.isLoaded ? clip.value : null;
    if (!listener || !buffer) return;

    // Its own node, because a three.js `Audio` plays one buffer at a time — which is exactly the
    // difference between this and `play()`. It disposes itself when the sound ends.
    const shot = this.spatial ? new PositionalAudio(listener) : new Audio(listener);
    if (shot instanceof PositionalAudio) {
      shot.setRefDistance(this.minDistance);
      shot.setMaxDistance(this.maxDistance);
      this.node.add(shot);
    }
    shot.setBuffer(buffer);
    shot.setVolume(this.volume * volumeScale);
    shot.setPlaybackRate(this.pitch);
    shot.onEnded = () => {
      shot.disconnect();
      shot.removeFromParent();
    };
    shot.play();
  }

  /** Set the volume live, on this source and anything it is already playing. */
  setVolume(volume: number): void {
    this.volume = volume;
    this.audio?.setVolume(volume);
  }

  private buffer(): AudioBuffer | null {
    return this.clip?.isLoaded ? this.clip.value : null;
  }
}
