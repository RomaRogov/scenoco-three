import { Vector3 } from 'three';
import {
  Behaviour, Coroutine, Input, KeyCode, SceneManager, Screen, Time, WaitForSeconds, WaitForSecondsRealtime, WaitUntil, destroy, findObjectOfType, findObjectsOfType, instantiate,
  type Yieldable,
} from '@scenoco-three/core';
import { BuildPad } from './BuildPad';
import { CameraRig } from './CameraRig';
import { Castle } from './Castle';
import { ENEMIES, REFUND, STAT_MAX, TOWERS, type EnemyKind, type TowerKind } from './data';
import { Enemy } from './Enemy';
import { LEVELS, LEVEL_ORDER, type LevelId } from './levels';
import { saveStars } from './progress';
import { route } from './routes';
import { SelectionMarker } from './SelectionMarker';
import { Sfx, type SoundName } from './Sfx';
import { Tower } from './Tower';
import { $, appear, arrive, clone, flick, loop, shake, sweep } from './hud';
import { ArcherTower, BuildDust, CannonTower, CoinBurst, FrostTower, Goblin, MageTower, Orc, Troll, Wolf } from './scenes/prefabs';

type Phase = 'ready' | 'spawning' | 'between' | 'won' | 'lost';

const KINDS = Object.keys(TOWERS) as TowerKind[];

/** Seconds between the end of one wave's arrivals and the next wave, unless the player calls it early. */
const BREATHER = 14;

/**
 * One level's run: gold, lives, the waves, and every tap on the map. The HUD and the sheets are
 * HTML in index.html; this keeps them in step.
 */
export class Game extends Behaviour {
  level: LevelId = 'meadow';

  gold = 0;
  lives = 0;
  /** Waves started so far. */
  wave = 0;
  phase: Phase = 'ready';
  speed = 1;
  paused = false;

  private countdown = 0;
  private spawning = 0;
  private selected: BuildPad | null = null;
  private shown = { gold: -1, lives: -1, wave: -1 };
  private cleanup: (() => void)[] = [];
  /** The next-wave button's pulse while it waits to be pressed. */
  private pulse: Coroutine | null = null;

  get spec() {
    return LEVELS[this.level];
  }

  override awake() {
    this.gold = this.spec.gold;
    this.lives = this.spec.lives;
    Time.timeScale = 1;
  }

  override start() {
    for (const id of ['title', 'won', 'lost', 'pause', 'banner']) $(id).classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('waves').textContent = `/${this.spec.waves.length}`;
    this.showNext(true);
    $('next-label').textContent = 'START';
    this.setRing(0);
    $('speed-text').textContent = '1×';
    $('speed').classList.remove('on');
    const rig = findObjectOfType(CameraRig);
    if (rig) this.listen(rig.onTap, (x, y) => this.tap(x, y));
    // The build cards are plain buttons: one listener each, removed when the level goes.
    for (const kind of KINDS) {
      const card = $(`build-${kind}`);
      const onClick = () => this.build(kind, card);
      card.addEventListener('click', onClick);
      this.cleanup.push(() => card.removeEventListener('click', onClick));
    }
    // The gold buttons' light sweeps across them for as long as the level runs.
    for (const shine of document.querySelectorAll<HTMLElement>('#ui .shine')) this.startCoroutine(sweep(shine));
    this.refreshHud();
  }

  override onDestroy() {
    for (const undo of this.cleanup) undo();
    this.closeSheets();
  }

  override update(dt: number) {
    this.buttons();
    if (this.phase === 'between') {
      this.countdown -= dt;
      this.setRing(1 - this.countdown / BREATHER);
      $('next-label').textContent = `+${this.earlyBonus()}`;
      if (this.countdown <= 0) this.callWave(false);
    }
    if ((this.phase === 'between' || this.phase === 'spawning') && this.wave >= this.spec.waves.length && this.spawning === 0 && findObjectsOfType(Enemy).length === 0) {
      this.win();
    }
    this.refreshHud();
  }

  // ── the economy ─────────────────────────────────────────────────────────────────────────

  enemyKilled(enemy: Enemy) {
    this.gold += enemy.spec.gold;
    this.pop(enemy.node.position, `+${enemy.spec.gold}`, 'coin');
    instantiate(CoinBurst, { position: enemy.node.position.clone().setY(enemy.node.position.y + 0.8) });
    this.sfx('coin', 0.5);
    this.bump('gold-chip');
  }

  enemyEscaped(enemy: Enemy) {
    if (this.phase === 'lost' || this.phase === 'won') return;
    this.lives = Math.max(0, this.lives - enemy.spec.lives);
    findObjectOfType(Castle)?.hit();
    findObjectOfType(CameraRig)?.shake(0.35);
    this.flash('vignette', 'flash');
    this.hurt();
    this.pop(enemy.node.position, `-${enemy.spec.lives}`, 'hurt');
    this.sfx('leak');
    if (this.lives <= 0) this.lose();
  }

  // ── waves ───────────────────────────────────────────────────────────────────────────────

  private callWave(early: boolean) {
    if (this.wave >= this.spec.waves.length || this.phase === 'won' || this.phase === 'lost') return;
    if (early && this.phase === 'between') {
      const bonus = this.earlyBonus();
      if (bonus > 0) {
        this.gold += bonus;
        this.bump('gold-chip');
        this.toast(`Early call: +${bonus} gold`);
      }
    }
    const index = this.wave++;
    this.phase = 'spawning';
    this.showNext(false);
    this.banner(index);
    this.sfx('horn');
    this.startCoroutine(this.spawnWave(index));
  }

  private earlyBonus() {
    return Math.max(0, Math.ceil(this.countdown * 1.5));
  }

  private *spawnWave(index: number) {
    const groups = this.spec.waves[index]!;
    const toughness = this.spec.toughness * (1 + this.spec.growth * index);
    this.spawning++;
    let finished = 0;
    for (const group of groups) {
      this.startCoroutine(this.spawnGroup(group.kind, group.count, group.gap, group.at ?? 0, toughness, () => finished++));
    }
    yield new WaitUntil(() => finished >= groups.length);
    this.spawning--;
    // Every wave that has arrived pays out: the money to answer the next one.
    const bonus = 20 + index * 6;
    if (this.phase !== 'lost') {
      this.gold += bonus;
      this.bump('gold-chip');
      this.toast(`Wave ${index + 1} cleared the gate: +${bonus} gold`);
    }
    if (this.phase === 'spawning' && this.wave < this.spec.waves.length) {
      this.phase = 'between';
      this.countdown = BREATHER;
      this.showNext(true);
    }
  }

  private *spawnGroup(kind: EnemyKind, count: number, gap: number, at: number, toughness: number, done: () => void) {
    if (at > 0) yield new WaitForSeconds(at);
    for (let i = 0; i < count; i++) {
      const enemy = instantiate({ goblin: Goblin, wolf: Wolf, orc: Orc, troll: Troll }[kind]).getComponent(Enemy);
      if (enemy) enemy.toughness = toughness;
      if (i < count - 1) yield new WaitForSeconds(gap);
    }
    done();
  }

  // ── the map: picking, building, upgrading ───────────────────────────────────────────────

  private tap(x: number, y: number) {
    if (this.phase === 'won' || this.phase === 'lost' || this.paused) return;
    const pad = this.padAt(x, y);
    if (!pad || pad === this.selected) {
      this.select(null);
      return;
    }
    this.select(pad);
    this.sfx('click', 0.6);
  }

  /** The pad nearest a screen point, within a fingertip's reach of its centre. */
  private padAt(x: number, y: number): BuildPad | null {
    const camera = this.camera;
    let best: BuildPad | null = null;
    let bestDistance = Math.max(44, Math.min(Screen.width, Screen.height) * 0.09);
    const p = new Vector3();
    for (const pad of findObjectsOfType(BuildPad)) {
      pad.node.getWorldPosition(p);
      p.y += pad.tower ? 1.2 : 0.2;
      p.project(camera);
      const sx = ((p.x + 1) / 2) * Screen.width;
      const sy = ((1 - p.y) / 2) * Screen.height;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = pad;
      }
    }
    return best;
  }

  private select(pad: BuildPad | null) {
    if (this.selected) this.selected.selected = false;
    this.selected = pad;
    const marker = findObjectOfType(SelectionMarker);
    if (!pad) {
      this.closeSheets();
      marker?.hide();
      return;
    }
    pad.selected = true;
    if (pad.tower) {
      marker?.show(pad.node.getWorldPosition(new Vector3()), pad.tower.stats.range);
      this.openTowerSheet(pad.tower);
    } else {
      marker?.hide();
      this.openBuildSheet();
    }
  }

  private build(kind: TowerKind, card: HTMLElement) {
    const pad = this.selected;
    if (!pad || pad.tower) return;
    const cost = TOWERS[kind].levels[0].cost;
    if (this.gold < cost) {
      this.refuse(card);
      return;
    }
    this.gold -= cost;
    const at = pad.node.getWorldPosition(new Vector3());
    at.y += 0.2;
    const prefab = { archer: ArcherTower, cannon: CannonTower, mage: MageTower, frost: FrostTower }[kind];
    const tower = instantiate(prefab, { position: at }).getComponent(Tower)!;
    tower.invested = cost;
    tower.pad = pad;
    pad.tower = tower;
    instantiate(BuildDust, { position: at });
    this.sfx('build');
    this.bump('gold-chip');
    this.select(null);
  }

  private upgradeSelected() {
    const tower = this.selected?.tower;
    const next = tower?.next;
    if (!tower || !next) return;
    if (this.gold < next.cost) {
      this.refuse($('ts-upgrade'));
      return;
    }
    this.gold -= next.cost;
    tower.upgrade();
    this.sfx('upgrade');
    this.bump('gold-chip');
    this.openTowerSheet(tower);
    findObjectOfType(SelectionMarker)?.show(tower.node.position, tower.stats.range);
  }

  private sellSelected() {
    const pad = this.selected;
    const tower = pad?.tower;
    if (!pad || !tower) return;
    const refund = Math.floor(tower.invested * REFUND);
    this.gold += refund;
    this.pop(tower.node.position, `+${refund}`, 'coin');
    instantiate(BuildDust, { position: tower.node.position.clone() });
    destroy(tower.node);
    pad.tower = null;
    this.sfx('sell');
    this.bump('gold-chip');
    this.select(null);
  }

  // ── buttons ─────────────────────────────────────────────────────────────────────────────

  private buttons() {
    if (Input.getButtonDown('NextWave') && (this.phase === 'ready' || this.phase === 'between')) this.callWave(true);
    if (Input.getButtonDown('Speed')) this.toggleSpeed();
    if (Input.getButtonDown('Pause') || Input.getKeyDown(KeyCode.Escape)) this.setPaused(!this.paused);
    if (Input.getButtonDown('Resume')) this.setPaused(false);
    if (Input.getButtonDown('CloseSheet')) this.select(null);
    if (Input.getButtonDown('Upgrade')) this.upgradeSelected();
    if (Input.getButtonDown('Sell')) this.sellSelected();
    if (Input.getButtonDown('Restart')) this.go(this.level);
    if (Input.getButtonDown('Menu')) this.go('menu');
    if (Input.getButtonDown('NextLevel')) {
      const next = LEVEL_ORDER[LEVEL_ORDER.indexOf(this.level) + 1];
      this.go(next ?? 'menu');
    }
  }

  private toggleSpeed() {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
    if (!this.paused) Time.timeScale = this.speed;
    $('speed-text').textContent = `${this.speed}×`;
    $('speed').classList.toggle('on', this.speed > 1);
    this.sfx('click', 0.6);
  }

  private setPaused(paused: boolean) {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.paused = paused;
    Time.timeScale = paused ? 0 : this.speed;
    if (paused) this.startCoroutine(appear('pause'));
    else $('pause').classList.add('hidden');
    if (paused) this.select(null);
  }

  private go(where: LevelId | 'menu') {
    Time.timeScale = 1;
    $('hud').classList.add('hidden');
    SceneManager.load(route(where));
  }

  // ── the end ─────────────────────────────────────────────────────────────────────────────

  private win() {
    this.phase = 'won';
    const share = this.lives / this.spec.lives;
    const stars = share >= 0.9 ? 3 : share >= 0.5 ? 2 : 1;
    saveStars(this.level, stars);
    this.select(null);
    this.showNext(false);
    this.startCoroutine(this.showWin(stars));
  }

  private *showWin(stars: number) {
    yield new WaitForSeconds(0.8);
    Time.timeScale = 1;
    this.sfx('win');
    const last = LEVEL_ORDER.indexOf(this.level) === LEVEL_ORDER.length - 1;
    $('won-next').classList.toggle('hidden', last);
    $('won-text').textContent = last ? 'Every bastion stands. Well played!' : `${this.lives} of ${this.spec.lives} lives kept.`;
    const shown = [...$('won-stars').children] as HTMLElement[];
    shown.forEach((star) => star.classList.remove('show', 'got'));
    this.startCoroutine(appear('won'));
    for (let i = 0; i < 3; i++) {
      yield new WaitForSeconds(0.35);
      shown[i]!.classList.add('show');
      if (i < stars) {
        shown[i]!.classList.add('got');
        this.sfx('star', 0.8);
      }
    }
  }

  private lose() {
    this.phase = 'lost';
    this.select(null);
    this.showNext(false);
    this.sfx('lose');
    this.startCoroutine(this.showLoss());
  }

  private *showLoss() {
    yield new WaitForSeconds(1);
    Time.timeScale = 1;
    $('lost-text').textContent = `Wave ${this.wave} of ${this.spec.waves.length} broke through.`;
    this.startCoroutine(appear('lost'));
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────────────────

  private refreshHud() {
    if (this.shown.gold !== this.gold) {
      this.shown.gold = this.gold;
      $('gold').textContent = String(this.gold);
      this.refreshCards();
      if (this.selected?.tower) this.refreshUpgrade(this.selected.tower);
    }
    if (this.shown.lives !== this.lives) {
      this.shown.lives = this.lives;
      $('lives').textContent = String(this.lives);
    }
    if (this.shown.wave !== this.wave) {
      this.shown.wave = this.wave;
      $('wave').textContent = String(this.wave);
    }
  }

  private refreshCards() {
    for (const kind of KINDS) $(`build-${kind}`).classList.toggle('poor', this.gold < TOWERS[kind].levels[0].cost);
  }

  private openBuildSheet() {
    $('tower-sheet').classList.remove('open');
    this.refreshCards();
    $('build-sheet').classList.add('open');
    // The cards come up one after another as it opens.
    this.startCoroutine(arrive(KINDS.map((kind) => $(`build-${kind}`))));
  }

  private openTowerSheet(tower: Tower) {
    $('build-sheet').classList.remove('open');
    const spec = TOWERS[tower.kind];
    const stats = tower.stats;
    const next = tower.next;
    $('ts-icon').className = `icon ${tower.kind}`;
    $('ts-name').textContent = spec.name;
    [...$('ts-stars').children].forEach((star, i) => star.classList.toggle('off', i + 1 > tower.level));
    const dps = (l: { damage: number; rate: number }) => l.damage * l.rate;
    this.bar('ts-dmg', stats.damage, next?.damage, STAT_MAX.damage);
    this.bar('ts-rng', stats.range, next?.range, STAT_MAX.range);
    this.bar('ts-spd', dps(stats), next ? dps(next) : undefined, STAT_MAX.dps);
    $('ts-dmg-v').textContent = String(stats.damage);
    $('ts-rng-v').textContent = stats.range.toFixed(1);
    $('ts-spd-v').textContent = `${stats.rate.toFixed(1)}/s`;
    const extra = stats.slow ? ` Slows to ${Math.round(stats.slow * 100)}% speed.` : stats.splash ? ` Splash ${stats.splash.toFixed(1)}.` : '';
    $('ts-note').textContent = spec.blurb + extra;
    $('ts-refund').textContent = String(Math.floor(tower.invested * REFUND));
    this.refreshUpgrade(tower);
    $('tower-sheet').classList.add('open');
  }

  private refreshUpgrade(tower: Tower) {
    const next = tower.next;
    const button = $('ts-upgrade') as HTMLButtonElement;
    $('ts-up-cost').textContent = next ? String(next.cost) : 'MAX';
    button.disabled = !next;
    button.classList.toggle('poor', !!next && this.gold < next.cost);
  }

  private bar(id: string, value: number, next: number | undefined, max: number) {
    ($(id) as HTMLElement).style.width = `${Math.min(100, (value / max) * 100)}%`;
    ($(`${id}-next`) as HTMLElement).style.width = `${Math.min(100, ((next ?? value) / max) * 100)}%`;
  }

  private closeSheets() {
    $('build-sheet').classList.remove('open');
    $('tower-sheet').classList.remove('open');
  }

  private banner(index: number) {
    const counts = new Map<EnemyKind, number>();
    for (const group of this.spec.waves[index]!) counts.set(group.kind, (counts.get(group.kind) ?? 0) + group.count);
    $('banner-text').textContent = index === this.spec.waves.length - 1 ? 'FINAL WAVE' : `WAVE ${index + 1}`;
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
    this.startCoroutine(this.showBanner());
  }

  /** In with a bounce, held, and up and away. */
  private *showBanner(): Generator<Yieldable> {
    const banner = $('banner');
    banner.classList.remove('hidden', 'shown');
    yield* arrive(banner);
    banner.classList.add('shown');
    yield new WaitForSecondsRealtime(1.9);
    banner.classList.remove('shown');
    yield new WaitForSecondsRealtime(0.5);
    banner.classList.add('hidden');
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
    this.pulse?.stop();
    this.pulse = null;
    next.classList.remove('pulse');
    if (shown) this.pulse = this.startCoroutine(loop(next, 'pulse', 0.7));
  }

  /** Floating text over a point in the world. */
  private pop(at: Vector3, text: string, kind: 'coin' | 'hurt') {
    const p = at.clone().setY(at.y + 1.4).project(this.camera);
    if (p.z > 1) return;
    const el = clone('pop');
    el.classList.toggle('hurt', kind === 'hurt');
    (el.querySelector('.say') as HTMLElement).textContent = text;
    if (kind === 'coin') el.append(Object.assign(document.createElement('div'), { className: 'icon coin' }));
    el.style.left = `${((p.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - p.y) / 2) * 100}%`;
    $('pops').appendChild(el);
    this.startCoroutine(this.rise(el));
  }

  /** Up out of the point and large; then on up, fading; then gone. */
  private *rise(el: HTMLElement): Generator<Yieldable> {
    yield null;
    el.classList.replace('start', 'mid');
    yield new WaitForSecondsRealtime(0.15);
    el.classList.remove('mid');
    yield new WaitForSecondsRealtime(0.85);
    el.remove();
  }

  private bump(id: string) {
    this.startCoroutine(flick($(id), 'bump', 0.12));
  }

  private flash(id: string, name: string) {
    this.startCoroutine(flick($(id), name, 0.05));
  }

  /** A life lost: the lives chip reddens and shakes. */
  private hurt() {
    this.startCoroutine(flick($('lives-chip'), 'hurt', 0.45));
    this.startCoroutine(shake($('lives-chip')));
  }

  private refuse(el: HTMLElement) {
    this.startCoroutine(shake(el));
    this.toast('Not enough gold');
    this.sfx('nope', 0.7);
  }

  private toast(text: string) {
    $('toast-text').textContent = text;
    this.startCoroutine(flick($('toast'), 'shown', 1.12));
  }

  private sfx(name: SoundName, volume = 1) {
    findObjectOfType(Sfx)?.play(name, volume);
  }
}
