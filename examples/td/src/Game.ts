import { Vector3 } from 'three';
import { Behaviour, Event, Input, Time, WaitForSeconds, findObjectOfType, findObjectsOfType, instantiate } from '@scenoco-three/core';
import { CameraRig } from './CameraRig';
import { Castle } from './Castle';
import { Enemy } from './Enemy';
import { LEVELS, LEVEL_ORDER, type LevelId } from './levels';
import { saveStars } from './progress';
import { goTo } from './routes';
import { Sfx } from './Sfx';
import { WaveSpawner } from './WaveSpawner';
import { CoinBurst } from './scenes/prefabs';

export type Phase = 'ready' | 'spawning' | 'between' | 'won' | 'lost';

/**
 * One level's run — Unity's game manager: its gold and lives, how it is going, how it ends, and where
 * it goes next. What the player sees of it is the `Hud`'s, which listens to these events; the waves are
 * the `WaveSpawner`'s, the map's taps the `BuildController`'s — all on this node.
 */
export class Game extends Behaviour {
  level: LevelId = 'meadow';

  gold = 0;
  lives = 0;
  phase: Phase = 'ready';

  /** Gold changed by `change`; `at` is where in the world it came from, when it came from somewhere. */
  readonly onGold = new Event<[gold: number, change: number, at: Vector3 | null]>();
  /** Lives lost to an enemy that got through at `at`. */
  readonly onLivesLost = new Event<[lives: number, lost: number, at: Vector3]>();
  readonly onWon = new Event<[stars: number]>();
  readonly onLost = new Event<[]>();

  get spec() {
    return LEVELS[this.level];
  }

  get over() {
    return this.phase === 'won' || this.phase === 'lost';
  }

  override awake() {
    this.gold = this.spec.gold;
    this.lives = this.spec.lives;
    Time.timeScale = 1;
  }

  override update() {
    if (Input.getButtonDown('Restart')) this.go(this.level);
    if (Input.getButtonDown('Menu')) this.go('menu');
    if (Input.getButtonDown('NextLevel')) this.go(LEVEL_ORDER[LEVEL_ORDER.indexOf(this.level) + 1] ?? 'menu');
    // Won once every wave has arrived and the last enemy is gone.
    if (!this.over && this.getComponent(WaveSpawner)?.done && findObjectsOfType(Enemy).length === 0) this.win();
  }

  // ── the economy ─────────────────────────────────────────────────────────────────────────

  earn(amount: number, at: Vector3 | null = null) {
    if (amount <= 0) return;
    this.gold += amount;
    this.onGold.emit(this.gold, amount, at);
  }

  /** Pays `cost` if there is enough gold: false, and nothing spent, if there is not. */
  spend(cost: number): boolean {
    if (this.gold < cost) return false;
    this.gold -= cost;
    this.onGold.emit(this.gold, -cost, null);
    return true;
  }

  enemyKilled(enemy: Enemy) {
    const at = enemy.node.position;
    this.earn(enemy.spec.gold, at);
    instantiate(CoinBurst, { position: at.clone().setY(at.y + 0.8) });
    findObjectOfType(Sfx)?.play('coin', 0.5);
  }

  enemyEscaped(enemy: Enemy) {
    if (this.over) return;
    this.lives = Math.max(0, this.lives - enemy.spec.lives);
    findObjectOfType(Castle)?.hit();
    findObjectOfType(CameraRig)?.shake(0.35);
    findObjectOfType(Sfx)?.play('leak');
    this.onLivesLost.emit(this.lives, enemy.spec.lives, enemy.node.position);
    if (this.lives <= 0) this.lose();
  }

  // ── the end ─────────────────────────────────────────────────────────────────────────────

  private win() {
    this.phase = 'won';
    const share = this.lives / this.spec.lives;
    const stars = share >= 0.9 ? 3 : share >= 0.5 ? 2 : 1;
    saveStars(this.level, stars);
    this.startCoroutine(this.end(0.8, () => this.onWon.emit(stars)));
  }

  private lose() {
    this.phase = 'lost';
    findObjectOfType(Sfx)?.play('lose');
    this.startCoroutine(this.end(1, () => this.onLost.emit()));
  }

  /** A moment for the last of it to land, at whatever speed the game runs — then normal time, and the screen. */
  private *end(seconds: number, show: () => void) {
    yield new WaitForSeconds(seconds);
    Time.timeScale = 1;
    show();
  }

  private go(where: LevelId | 'menu') {
    Time.timeScale = 1;
    void goTo(where);
  }
}
