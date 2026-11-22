import { Vector3 } from 'three';
import { Behaviour, Input, Screen, destroy, findObjectOfType, findObjectsOfType, instantiate } from '@scenoco-three/core';
import { BuildPad } from './BuildPad';
import { CameraRig } from './CameraRig';
import { REFUND, STAT_MAX, TOWERS, type TowerKind } from './data';
import { Game } from './Game';
import { HudController } from './HudController';
import { SelectionMarker } from './SelectionMarker';
import { Sfx } from './Sfx';
import { TimeControls } from './TimeControls';
import { Tower } from './Tower';
import { $, arrive } from './hud';
import { ArcherTower, BuildDust, CannonTower, FrostTower, MageTower } from './scenes/prefabs';

const KINDS = Object.keys(TOWERS) as TowerKind[];

/**
 * The map under the player's finger: a tap picks the pad nearest it, an empty pad opens the build sheet
 * and a tower's its own — upgrade or sell — with its range drawn round it.
 */
export class BuildController extends Behaviour {
  private selected: BuildPad | null = null;
  private cleanup: (() => void)[] = [];

  private get game() {
    return this.getComponent(Game)!;
  }

  override start() {
    const rig = findObjectOfType(CameraRig);
    if (rig) this.listen(rig.onTap, (x, y) => this.tap(x, y));
    // The cards' poverty and the upgrade button's follow the gold.
    this.listen(this.game.onGold, () => {
      this.refreshCards();
      if (this.selected?.tower) this.refreshUpgrade(this.selected.tower);
    });
    // The build cards are plain buttons: one listener each, removed when the level goes.
    for (const kind of KINDS) {
      const card = $(`build-${kind}`);
      const onClick = () => this.build(kind, card);
      card.addEventListener('click', onClick);
      this.cleanup.push(() => card.removeEventListener('click', onClick));
    }
  }

  override onDestroy() {
    for (const undo of this.cleanup) undo();
    this.closeSheets();
  }

  override update() {
    // The run is over: nothing left to build.
    if (this.game.over && this.selected) this.select(null);
    if (Input.getButtonDown('CloseSheet')) this.select(null);
    if (Input.getButtonDown('Upgrade')) this.upgradeSelected();
    if (Input.getButtonDown('Sell')) this.sellSelected();
  }

  select(pad: BuildPad | null) {
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

  private tap(x: number, y: number) {
    if (this.game.over || this.getComponent(TimeControls)?.paused) return;
    const pad = this.padAt(x, y);
    if (!pad || pad === this.selected) {
      this.select(null);
      return;
    }
    this.select(pad);
    this.getComponent(Sfx)?.play('click', 0.6);
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
      const d = Math.hypot(((p.x + 1) / 2) * Screen.width - x, ((1 - p.y) / 2) * Screen.height - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = pad;
      }
    }
    return best;
  }

  private build(kind: TowerKind, card: HTMLElement) {
    const pad = this.selected;
    if (!pad || pad.tower) return;
    const cost = TOWERS[kind].levels[0].cost;
    if (!this.game.spend(cost)) return this.getComponent(HudController)?.refuse(card);
    const at = pad.node.getWorldPosition(new Vector3());
    at.y += 0.2;
    // Read here, not in a table at load: the prefabs import what imports this.
    const tower = instantiate({ archer: ArcherTower, cannon: CannonTower, mage: MageTower, frost: FrostTower }[kind], { position: at }).getComponent(Tower)!;
    tower.invested = cost;
    tower.pad = pad;
    pad.tower = tower;
    instantiate(BuildDust, { position: at });
    this.getComponent(Sfx)?.play('build');
    this.select(null);
  }

  private upgradeSelected() {
    const tower = this.selected?.tower;
    const next = tower?.next;
    if (!tower || !next) return;
    if (!this.game.spend(next.cost)) return this.getComponent(HudController)?.refuse($('ts-upgrade'));
    tower.upgrade();
    this.getComponent(Sfx)?.play('upgrade');
    this.openTowerSheet(tower);
    findObjectOfType(SelectionMarker)?.show(tower.node.position, tower.stats.range);
  }

  private sellSelected() {
    const pad = this.selected;
    const tower = pad?.tower;
    if (!pad || !tower) return;
    this.game.earn(Math.floor(tower.invested * REFUND), tower.node.position);
    instantiate(BuildDust, { position: tower.node.position.clone() });
    destroy(tower.node);
    pad.tower = null;
    this.getComponent(Sfx)?.play('sell');
    this.select(null);
  }

  // ── the sheets ──────────────────────────────────────────────────────────────────────────

  private refreshCards() {
    for (const kind of KINDS) $(`build-${kind}`).classList.toggle('poor', this.game.gold < TOWERS[kind].levels[0].cost);
  }

  private openBuildSheet() {
    $('tower-sheet').classList.remove('open');
    this.refreshCards();
    $('build-sheet').classList.add('open');
    // The cards come up one after another as it opens.
    arrive(KINDS.map((kind) => $(`build-${kind}`)));
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
    button.classList.toggle('poor', !!next && this.game.gold < next.cost);
  }

  private bar(id: string, value: number, next: number | undefined, max: number) {
    $(id).style.width = `${Math.min(100, (value / max) * 100)}%`;
    $(`${id}-next`).style.width = `${Math.min(100, ((next ?? value) / max) * 100)}%`;
  }

  private closeSheets() {
    $('build-sheet').classList.remove('open');
    $('tower-sheet').classList.remove('open');
  }
}
