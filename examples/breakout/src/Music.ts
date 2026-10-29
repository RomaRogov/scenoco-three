import { Behaviour, Input, KeyCode, PlayerPrefs, Time, findObjectOfType } from '@scenoco-three/core';
import { GameState } from './GameState.js';
import { Progress } from './Progress.js';
import { audioBus, glide } from './sound/bus.js';
import { loadChips } from './sound/chips.js';
import { Engine } from './sound/engine.js';
import { Song, keyOf } from './sound/song.js';

/**
 * The music: a Mega Drive's two chips, played live, the arrangement following the game. It lives
 * in the `Run` scene, kept across every level, so a level load never restarts it.
 *
 * Every frame it reads the level: how much of the wall is gone, the combo, the balls in play — and
 * turns that into the song's intensity, its key (one per stage), its tempo (faster with the last few
 * bricks), and a muffle while a banner is up. A lost ball, or a level change, fades the music out
 * and starts the piece over from its top.
 *
 * The chips render on the page's thread a little ahead of what is heard — about 0.6 ms of work for
 * every 100 ms of music — into buffers queued back to back on the AudioContext.
 */
export class Music extends Behaviour {
  /** 0 to 1. */
  volume = 0.55;
  /** Seconds rendered ahead of what is heard: enough to ride out a slow frame. */
  lookahead = 0.2;

  private song: Song | null = null;
  private engine: Engine | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** When, on the AudioContext's clock, the next buffer starts. */
  private next = 0;
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
    void loadChips().then((chips) => {
      if (this.isDestroyed) return;
      this.engine = new Engine(chips, bus.context.sampleRate, () => this.song?.step());
      this.song = new Song(this.engine);
      this.timer = setInterval(() => this.pump(), 25);
    });
  }

  override onDestroy(): void {
    if (this.timer) clearInterval(this.timer);
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
    glide(bus.master.gain, this.muted ? 0 : 1, 0.15);
    this.button?.classList.toggle('off', this.muted);
  }

  /** The song, set from where the game is. */
  private follow(): void {
    const song = this.song;
    if (!song) return;
    const game = findObjectOfType(GameState);
    if (game !== this.game) {
      this.game = game;
      this.bricksAtStart = Math.max(1, game?.bricksLeft ?? 1);
      if (game) this.listen(game.ballLost, () => this.song?.restart());
    }
    // The screen starting to fade to the next level: the music fades with it.
    const changing = this.progress?.changing ?? false;
    if (changing && !this.changing && this.game) song.restart();
    this.changing = changing;
    const phase = game?.phase ?? 'ready';
    let intensity = 0;
    if (game && phase === 'playing') {
      const cleared = 1 - game.bricksLeft / this.bricksAtStart;
      intensity = 1;
      if (cleared >= 0.35 || game.combo >= 3 || game.ballsInPlay > 1) intensity = 2;
      if (cleared >= 0.7 || game.combo >= 6) intensity = 3;
    }
    song.intensity = intensity;
    song.key = keyOf(this.progress?.stage ?? 0);
    song.tempo = game && phase === 'playing' && game.bricksLeft <= 3 ? 152 : 138;

    // Under a banner, or paused, the music goes on as if through a wall.
    const muffled = (phase !== 'playing' && phase !== 'ready') || Time.timeScale === 0;
    if (muffled !== this.muffled) {
      this.muffled = muffled;
      const bus = audioBus();
      if (bus) glide(bus.muffle.frequency, muffled ? 650 : 20000, muffled ? 0.4 : 0.8);
    }
  }

  /** Render what will be heard next and queue it, until `lookahead` seconds are waiting. */
  private pump(): void {
    const bus = audioBus();
    const engine = this.engine;
    if (!bus || !engine || bus.context.state !== 'running') return;
    const { context } = bus;
    // After a stall — a hidden tab — start again just ahead, rather than catch up with a burst.
    if (this.next < context.currentTime) this.next = context.currentTime + 0.03;
    while (this.next < context.currentTime + this.lookahead) {
      const frames = 2048;
      const { left, right } = engine.render(frames);
      const buffer = context.createBuffer(2, frames, engine.rate);
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(bus.music);
      source.start(this.next);
      this.next += frames / engine.rate;
    }
  }
}
