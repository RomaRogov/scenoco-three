import { Audio, PositionalAudio } from 'three';
import { Component, component, property, ValueType } from '@scenoco-three/core';

/**
 * Plays an audio clip — 2D (global, for music/UI/SFX) or **positional** 3D
 * (attenuates with distance from the camera). The `src` is an `asset` URL loaded
 * into `engine.assets` (preloaded by `loadSceneAsync`, or streamed in under a
 * synchronous `loadScene`); the buffer is decoded by three's `AudioLoader`.
 *
 *   <Mesh><Sound src="music.mp3" loop="true" /></Mesh>                <!-- 2D background music -->
 *   <Mesh><Sound src="engine.ogg" positional="true" loop="true" /></Mesh>  <!-- 3D world sound -->
 *
 * The "ears" are `engine.audioListener`, created lazily on the active camera, so a
 * scene with no `<Sound>` never opens an `AudioContext`. Headless (no Web Audio)
 * the component is inert. Call `play()` / `stop()` to control it from other code.
 */
@component({ name: 'Sound', description: 'Plays an audio clip (2D, or positional 3D).' })
export class Sound extends Component {
  @property({ type: ValueType.String, asset: 'audio', description: 'Audio file URL' })
  src = '';
  @property({ type: ValueType.Bool, description: 'Play as soon as the clip is loaded' })
  autoplay = true;
  @property({ type: ValueType.Bool, description: 'Loop the clip' }) loop = false;
  @property({ type: ValueType.Float, description: 'Volume 0..1' }) volume = 1;
  @property({ type: ValueType.Bool, description: 'Positional (3D) audio that attenuates with distance' })
  positional = false;
  @property({ type: ValueType.Float, description: 'Reference distance for positional falloff' })
  refDistance = 1;

  /** The live three.js audio node (undefined before load / when headless). */
  audio?: Audio | PositionalAudio;

  override start(): void {
    const listener = this.engine.audioListener;
    if (!listener || !this.src) return; // no Web Audio (headless) or nothing to play

    const audio = this.positional ? new PositionalAudio(listener) : new Audio(listener);
    if (audio instanceof PositionalAudio) {
      audio.setRefDistance(this.refDistance);
      this.node.add(audio); // positional audio is heard from the node's position
    }
    audio.setLoop(this.loop);
    audio.setVolume(this.volume);
    this.audio = audio;

    // Resolve the decoded buffer (sync if preloaded, else streamed in), then play.
    this.engine.assets.resolve<AudioBuffer>(this.src, (buffer) => {
      audio.setBuffer(buffer);
      if (this.autoplay) audio.play();
    });
  }

  /** Start (or restart) playback. */
  play(): void {
    this.audio?.play();
  }

  /** Stop playback (if playing). */
  stop(): void {
    if (this.audio?.isPlaying) this.audio.stop();
  }

  /** Set the volume (0..1), live. */
  setVolume(volume: number): void {
    this.volume = volume;
    this.audio?.setVolume(volume);
  }

  override onDestroy(): void {
    const audio = this.audio;
    if (!audio) return;
    if (audio.isPlaying) audio.stop();
    audio.disconnect();
    if (audio instanceof PositionalAudio) this.node.remove(audio);
    this.audio = undefined;
  }
}
