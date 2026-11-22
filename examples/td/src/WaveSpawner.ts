import { Behaviour, Event, Input, Tween, WaitForSeconds, WaitUntil, instantiate } from '@scenoco-three/core';
import { ENEMIES, type EnemyKind } from './data';
import { Enemy } from './Enemy';
import { Game } from './Game';
import { HudController } from './HudController';
import { Sfx } from './Sfx';
import { $, arrive, clone, loop } from './hud';
import { Goblin, Orc, Troll, Wolf } from './scenes/prefabs';

/**
 * The level's waves, from its spec: each one's groups spawned in step by coroutines, a breather between
 * them that the next-wave button cuts short for a gold bonus, and the banner that names who is coming.
 */
export class WaveSpawner extends Behaviour {
  /** Seconds between the end of one wave's arrivals and the next wave, unless the player calls it early. */
  breather = 14;

  /** Waves started so far. */
  wave = 0;

  readonly onWaveStarted = new Event<[index: number, of: number]>();

  private countdown = 0;
  private spawning = 0;
  /** The next-wave button's pulse while it waits to be pressed. */
  private pulse: Tween | null = null;

  private get game() {
    return this.getComponent(Game)!;
  }

  private get waves() {
    return this.game.spec.waves;
  }

  /** Every wave has started and every enemy in them has arrived. */
  get done() {
    return this.wave >= this.waves.length && this.spawning === 0;
  }

  override start() {
    $('waves').textContent = `/${this.waves.length}`;
    $('next-label').textContent = 'START';
    this.setRing(0);
    this.showNext(true);
  }

  override update(dt: number) {
    const game = this.game;
    // Nothing more to call once the run is over: the button goes the moment it ends.
    if (game.over) {
      if (this.pulse) this.showNext(false);
      return;
    }
    if (Input.getButtonDown('NextWave') && (game.phase === 'ready' || game.phase === 'between')) this.callWave(true);
    if (game.phase === 'between') {
      this.countdown -= dt;
      this.setRing(1 - this.countdown / this.breather);
      $('next-label').textContent = `+${this.earlyBonus()}`;
      if (this.countdown <= 0) this.callWave(false);
    }
  }

  private callWave(early: boolean) {
    const game = this.game;
    if (this.wave >= this.waves.length || game.over) return;
    if (early && game.phase === 'between') {
      const bonus = this.earlyBonus();
      if (bonus > 0) {
        game.earn(bonus);
        this.getComponent(HudController)?.toast(`Early call: +${bonus} gold`);
      }
    }
    const index = this.wave++;
    game.phase = 'spawning';
    this.showNext(false);
    this.banner(index);
    this.getComponent(Sfx)?.play('horn');
    this.onWaveStarted.emit(index, this.waves.length);
    this.startCoroutine(this.spawnWave(index));
  }

  private earlyBonus() {
    return Math.max(0, Math.ceil(this.countdown * 1.5));
  }

  private *spawnWave(index: number) {
    const game = this.game;
    const groups = this.waves[index]!;
    const toughness = game.spec.toughness * (1 + game.spec.growth * index);
    this.spawning++;
    let finished = 0;
    for (const group of groups) {
      this.startCoroutine(this.spawnGroup(group.kind, group.count, group.gap, group.at ?? 0, toughness, () => finished++));
    }
    yield new WaitUntil(() => finished >= groups.length);
    this.spawning--;
    // Every wave that has arrived pays out: the money to answer the next one.
    if (game.phase !== 'lost') {
      const bonus = 20 + index * 6;
      game.earn(bonus);
      this.getComponent(HudController)?.toast(`Wave ${index + 1} cleared the gate: +${bonus} gold`);
    }
    if (game.phase === 'spawning' && this.wave < this.waves.length) {
      game.phase = 'between';
      this.countdown = this.breather;
      this.showNext(true);
    }
  }

  private *spawnGroup(kind: EnemyKind, count: number, gap: number, at: number, toughness: number, done: () => void) {
    if (at > 0) yield new WaitForSeconds(at);
    for (let i = 0; i < count; i++) {
      // Read here, not in a table at load: the prefabs import the enemies, which import this.
      const enemy = instantiate({ goblin: Goblin, wolf: Wolf, orc: Orc, troll: Troll }[kind]).getComponent(Enemy);
      if (enemy) enemy.toughness = toughness;
      if (i < count - 1) yield new WaitForSeconds(gap);
    }
    done();
  }

  // ── its part of the page ────────────────────────────────────────────────────────────────

  /** The wave's name and who is in it, one icon a kind. */
  private banner(index: number) {
    const counts = new Map<EnemyKind, number>();
    for (const group of this.waves[index]!) counts.set(group.kind, (counts.get(group.kind) ?? 0) + group.count);
    $('banner-text').textContent = index === this.waves.length - 1 ? 'FINAL WAVE' : `WAVE ${index + 1}`;
    $('banner-who').replaceChildren(
      ...[...counts].map(([kind, n]) => {
        const who = clone('who');
        const icon = who.querySelector('.icon') as HTMLElement;
        icon.classList.add(kind);
        icon.title = ENEMIES[kind].name;
        (who.querySelector('.count') as HTMLElement).textContent = `×${n}`;
        return who;
      }),
    );
    // In with a bounce, held, and up and away.
    const shown = $('banner');
    shown.classList.remove('hidden', 'shown');
    arrive(shown);
    Tween.sequence()
      .appendCallback(() => shown.classList.add('shown'))
      .appendInterval(1.9)
      .appendCallback(() => shown.classList.remove('shown'))
      .appendInterval(0.5)
      .appendCallback(() => shown.classList.add('hidden'))
      .setUpdate(true)
      .setLink(this);
  }

  /** The ring fills clockwise from the top: each half turned into view inside its clip. */
  private setRing(fill: number) {
    const f = Math.max(0, Math.min(1, fill));
    $('arc-right').style.rotate = `${-180 + Math.min(f, 0.5) * 360}deg`;
    $('arc-left').style.rotate = `${-180 + Math.max(f - 0.5, 0) * 360}deg`;
  }

  /** The next-wave button, there and pulsing — or gone. */
  private showNext(shown: boolean) {
    const next = $('next');
    next.classList.toggle('gone', !shown);
    this.pulse?.kill();
    this.pulse = null;
    next.classList.remove('pulse');
    if (shown) this.pulse = loop(next, 'pulse', 0.7).setLink(this);
  }
}
