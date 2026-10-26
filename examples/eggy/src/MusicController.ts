import { AudioSource } from '@scenoco-three/audio';
import { Behaviour, WaitForSeconds, destroy, dontDestroyOnLoad, type Yieldable } from '@scenoco-three/core';
import { sounds } from './assets';

/**
 * The game's sound — the Unity game's `MusicController`. The first one keeps playing across every
 * reload; each later copy, from the scene loading again, removes itself.
 */
export class MusicController extends Behaviour {
  private backMusic!: AudioSource;
  private rollSound!: AudioSource;
  private starSound!: AudioSource;
  private winSound!: AudioSource;
  private crashSound!: AudioSource;
  private dropSound!: AudioSource;

  private static instance: MusicController | null = null;

  static setRollingVol(vol: number): void {
    const roll = MusicController.instance?.rollSound;
    if (roll && roll.volume < vol) roll.volume = Math.min(vol, 1);
  }

  static playStar(): void {
    MusicController.instance?.starSound.play();
  }

  static gameOver(lose: boolean): void {
    const self = MusicController.instance;
    if (!self) return;
    if (lose) self.crashSound.play();
    else self.startCoroutine(self.playWin());
  }

  private *playWin(): Generator<Yieldable> {
    this.winSound.play();
    yield new WaitForSeconds(0.7);
    this.dropSound.play();
  }

  override awake() {
    if (MusicController.instance) {
      destroy(this.node);
      return;
    }
    MusicController.instance = this;
    dontDestroyOnLoad(this);
    // The prefab's AudioSources, with their volumes.
    const source = (clip: AudioSource['clip'], volume: number, loop = false) =>
      this.node.addComponent(AudioSource, { clip, volume, loop, playOnAwake: false });
    this.backMusic = source(sounds.music, 0.558, true);
    this.rollSound = source(sounds.roll, 0, true);
    this.starSound = source(sounds.star, 1);
    this.winSound = source(sounds.win, 1);
    this.crashSound = source(sounds.crash, 1);
    this.dropSound = source(sounds.drop, 1);
  }

  override start() {
    if (MusicController.instance !== this) return;
    this.backMusic.play();
    this.rollSound.play();
  }

  override update() {
    if (this.rollSound && this.rollSound.volume > 0) this.rollSound.volume = Math.max(0, this.rollSound.volume - 0.02);
  }
}
