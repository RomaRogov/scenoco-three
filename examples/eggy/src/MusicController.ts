import type { AudioSource } from '@scenoco-three/audio';
import { Behaviour, WaitForSeconds, destroy, dontDestroyOnLoad, type Yieldable } from '@scenoco-three/core';

/**
 * The game's sound — the Unity game's `MusicController`, playing the AudioSources the scene gives it.
 * The first one keeps playing across every reload; each later copy, from the scene loading again,
 * removes itself.
 */
export class MusicController extends Behaviour {
  backMusic: AudioSource | null = null;
  rollSound: AudioSource | null = null;
  starSound: AudioSource | null = null;
  winSound: AudioSource | null = null;
  crashSound: AudioSource | null = null;
  dropSound: AudioSource | null = null;

  private static instance: MusicController | null = null;

  static setRollingVol(vol: number): void {
    const roll = MusicController.instance?.rollSound;
    if (roll && roll.volume < vol) roll.volume = Math.min(vol, 1);
  }

  static playStar(): void {
    MusicController.instance?.starSound?.play();
  }

  static gameOver(lose: boolean): void {
    const self = MusicController.instance;
    if (!self) return;
    if (lose) self.crashSound?.play();
    else self.startCoroutine(self.playWin());
  }

  private *playWin(): Generator<Yieldable> {
    this.winSound?.play();
    yield new WaitForSeconds(0.7);
    this.dropSound?.play();
  }

  override awake() {
    if (MusicController.instance) {
      destroy(this.node);
      return;
    }
    MusicController.instance = this;
    dontDestroyOnLoad(this);
  }

  override start() {
    if (MusicController.instance !== this) return;
    this.backMusic?.play();
    this.rollSound?.play();
  }

  override update() {
    if (this.rollSound && this.rollSound.volume > 0) this.rollSound.volume = Math.max(0, this.rollSound.volume - 0.02);
  }
}
