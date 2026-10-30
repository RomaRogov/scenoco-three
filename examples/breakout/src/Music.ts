import { Behaviour, Input, KeyCode, PlayerPrefs, Time, findObjectOfType } from '@scenoco-three/core';
import { GameState } from './GameState.js';
import { Progress } from './Progress.js';
import { audioBus } from './audio.js';
import { keyOf, songProgram, type SongMessage } from './song.js';
import { startPlayer, type ChipPlayer } from './sound/player.js';
import songWorklet from './song.worklet.ts?worker&url';

/**
 * The music: a Mega Drive's two chips, played live, the arrangement following the game. It lives
 * in the `Run` scene, kept across every level, so a level load never restarts it.
 *
 * Every frame it reads the level: how much of the wall is gone, the combo, the balls in play — and
 * turns that into the song's intensity, its key (one per stage), its tempo (faster with the last few
 * bricks), and a muffle while a banner is up. A lost ball, or a level change, fades the music out
 * and starts the piece over from its top.
 *
 * The chips play on the audio thread, in an AudioWorklet (`song.worklet.ts`): the song is told only
 * what changed, so the page's own thread — a quarter of it, on a weak phone — is left to the game.
 * Where there is no AudioWorklet (a page that is not https or localhost) they play on the page's thread.
 */
export class Music extends Behaviour {
  /** 0 to 1. */
  volume = 0.55;

  private song: ChipPlayer | null = null;
  /** What the song was last told, so it is told again only when the game changes it. */
  private told = '';
  private game: GameState | null = null;
  private progress: Progress | null = null;
  private bricksAtStart = 1;
  private muted = false;
  private muffled = false;
  private changing = false;
  /** The page's sound switch, `<button data-button="Sound">`. */
  private button: HTMLElement | null = null;

  override awake(): void {
    this.progress = findObjectOfType(Progress);
    const bus = audioBus();
    if (!bus) return;
    this.button = document.getElementById('sound');
    this.muted = PlayerPrefs.getInt('muted', 0) === 1;
    bus.music.gain.value = this.volume;
    bus.master.gain.value = this.muted ? 0 : 1;
    this.button?.classList.toggle('off', this.muted);
    startPlayer(bus.context, { worklet: songWorklet, name: 'song', program: songProgram, output: bus.music })
      .then((player) => {
        if (this.isDestroyed) return player.stop();
        this.song = player;
      })
      .catch((error: unknown) => console.error('The music could not start:', error));
  }

  override onDestroy(): void {
    this.song?.stop();
  }

  override update(): void {
    if (Input.getButtonDown('Sound') || Input.getKeyDown(KeyCode.M) || Input.getKeyDown(KeyCode.JoystickButton8)) this.toggle();
    this.follow();
  }

  /** Sound on or off for the whole game, remembered across visits. */
  private toggle(): void {
    const bus = audioBus();
    if (!bus) return;
    this.muted = !this.muted;
    PlayerPrefs.setInt('muted', this.muted ? 1 : 0);
    bus.glide(bus.master.gain, this.muted ? 0 : 1, 0.15);
    this.button?.classList.toggle('off', this.muted);
  }

  /** The song, set from where the game is. */
  private follow(): void {
    if (!this.song) return;
    const game = findObjectOfType(GameState);
    if (game !== this.game) {
      this.game = game;
      this.bricksAtStart = Math.max(1, game?.bricksLeft ?? 1);
      if (game) this.listen(game.ballLost, () => this.tell('restart'));
    }
    // The screen starting to fade to the next level: the music fades with it.
    const changing = this.progress?.changing ?? false;
    if (changing && !this.changing && this.game) this.tell('restart');
    this.changing = changing;
    const phase = game?.phase ?? 'ready';
    let intensity = 0;
    if (game && phase === 'playing') {
      const cleared = 1 - game.bricksLeft / this.bricksAtStart;
      intensity = 1;
      if (cleared >= 0.35 || game.combo >= 3 || game.ballsInPlay > 1) intensity = 2;
      if (cleared >= 0.7 || game.combo >= 6) intensity = 3;
    }
    const state = { intensity, key: keyOf(this.progress?.stage ?? 0), tempo: game && phase === 'playing' && game.bricksLeft <= 3 ? 152 : 138 };
    const told = JSON.stringify(state);
    if (told !== this.told) {
      this.told = told;
      this.tell(state);
    }

    // Under a banner, or paused, the music goes on as if through a wall.
    const muffled = (phase !== 'playing' && phase !== 'ready') || Time.timeScale === 0;
    if (muffled !== this.muffled) {
      this.muffled = muffled;
      const bus = audioBus();
      if (bus) bus.glide(bus.muffle.frequency, muffled ? 650 : 20000, muffled ? 0.4 : 0.8);
    }
  }

  private tell(message: SongMessage): void {
    this.song?.post(message);
  }
}
