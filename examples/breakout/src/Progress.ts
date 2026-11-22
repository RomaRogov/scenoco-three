import type { Vector3 } from 'three';
import { Behaviour, Event, Input, KeyCode, SceneManager, Tween, dontDestroyOnLoad } from '@scenoco-three/core';
import type { GameState } from './GameState.js';

/**
 * The run — score, lives, which level — and how it moves between levels.
 *
 * It lives in the `Run` scene, which it keeps with `dontDestroyOnLoad`, so it is the one thing a level
 * load does not touch: the score outlives the level that earned it, and nothing copies state across.
 * The level's own rules live in `GameState`, rebuilt with every level, which reports here. What the
 * player sees of all this is the `RunHud`'s, on the same node: it listens to these events.
 *
 * The run opens on a splash with a PLAY button, the first level waiting behind it. That press is the
 * player's first touch of the page, which is what a browser waits for before it lets sound play — so
 * the music starts from its first bar with the game, not halfway into the first rally.
 */
export class Progress extends Behaviour {
  /** The levels, in order: scene functions, as `SceneManager.load` takes them. */
  levels: (() => unknown)[] = [];
  startingLives = 3;
  /** Points a brick is worth, times the hits it took, times the rally's combo. */
  pointsPerHit = 50;

  score = 0;
  lives = 3;
  /** False until PLAY is pressed on the splash. */
  begun = false;

  /** A level is built and its `GameState` has reported in — the splash's level too. */
  readonly onLevelLoaded = new Event<[game: GameState]>();
  /** A stage starts being played: PLAY on the splash, or a level loaded after it. */
  readonly onStageStarted = new Event<[stage: number]>();
  /** A brick earned `points` at `at`; `hot` in a rally. */
  readonly onScored = new Event<[points: number, at: Vector3, hot: boolean]>();
  readonly onLifeLost = new Event<[lives: number]>();
  /** A level change began: the screen goes dark before the next level loads. */
  readonly onLeaving = new Event<[]>();

  /** 0-based index into `levels`. */
  private index = 0;
  /** The level being played, which owns the phase. Null between loads. */
  private current: GameState | null = null;
  private fading = false;

  override awake(): void {
    dontDestroyOnLoad(this);
    this.lives = this.startingLives;
  }

  override start(): void {
    // The page opens already black: the first level fades in from it, with no fade out first.
    this.load(0);
  }

  override update(): void {
    const phase = this.current?.phase;
    if (phase === 'title' || phase === 'ready' || phase === 'playing' || this.fading) return;
    if (Input.getButtonDown('Continue') || Input.getKeyDown(KeyCode.Space) || Input.getKeyDown(KeyCode.JoystickButton0)) this.advance();
  }

  override lateUpdate(): void {
    // After every update has run, so the press that leaves the splash cannot also launch the ball.
    // PLAY, Space or Enter — or a gamepad's A or Start.
    const start =
      Input.getButtonDown('Play') || Input.getKeyDown(KeyCode.Space) || Input.getKeyDown(KeyCode.Return) ||
      Input.getKeyDown(KeyCode.JoystickButton0) || Input.getKeyDown(KeyCode.JoystickButton9);
    if (this.current?.phase === 'title' && start) {
      this.begun = true;
      this.current.phase = 'ready';
      this.onStageStarted.emit(this.index);
    }
  }

  // --- what the level tells it ------------------------------------------------------------

  /** Called from a level's `GameState.start`, which is the moment that level is fully built. */
  beginLevel(game: GameState): void {
    this.current = game;
    if (!this.begun) game.phase = 'title';
    this.fading = false;
    this.onLevelLoaded.emit(game);
    if (this.begun) this.onStageStarted.emit(this.index);
  }

  /** A brick broke at `at`: its points. */
  award(hitsTaken: number, combo: number, at: Vector3): void {
    const points = this.pointsPerHit * hitsTaken * Math.max(1, combo);
    this.score += points;
    this.onScored.emit(points, at, combo > 1);
  }

  /** The ball was missed. True while there is still a ball to lose. */
  loseLife(): boolean {
    this.lives -= 1;
    this.onLifeLost.emit(this.lives);
    return this.lives > 0;
  }

  /** The level being played, or null between loads. */
  get game(): GameState | null {
    return this.current;
  }

  /** True from the moment a level change starts fading out until the next level is in. */
  get changing(): boolean {
    return this.fading;
  }

  /** Which level is being played, from 0. */
  get stage(): number {
    return this.index;
  }

  /** True when the level just cleared was the last one. */
  get onLastLevel(): boolean {
    return this.index + 1 >= this.levels.length;
  }

  // --- moving between levels --------------------------------------------------------------

  /** A tap on the banner: on to the next level, or back to the first. */
  advance(): void {
    const phase = this.current?.phase;
    if (phase === 'cleared') return this.go(this.index + 1);
    if (phase === 'lost' || phase === 'won') {
      this.score = 0;
      this.lives = this.startingLives;
      this.go(0);
    }
  }

  /** To level `index`: the screen fades to black, the level loads behind it, and fades in. */
  private go(index: number): void {
    if (this.fading || !this.levels[index]) return;
    this.fading = true;
    this.onLeaving.emit();
    // The fade's CSS transition is 0.6 s: on real time, so a paused game still leaves.
    Tween.delayedCall(0.6, () => this.load(index)).setUpdate(true).setLink(this);
  }

  private load(index: number): void {
    this.index = index;
    this.current = null;
    this.fading = true;
    SceneManager.load(this.levels[index]!);
  }
}
