import { type Object3D, Vector3 } from 'three';
import { Behaviour, findObjectOfType, findObjectsOfType, instantiate, type Prefab } from '@scenoco-three/core';
import type { BuildPad } from './BuildPad';
import { TOWERS, type TowerKind } from './data';
import { Enemy } from './Enemy';
import { Projectile } from './Projectile';
import { Punch } from './Punch';
import { Sfx, type SoundName } from './Sfx';


/**
 * A tower on a pad: picks the enemy furthest along the path within range and fires its projectile.
 * Three levels; each upgrade grows the model a little, adds a star over it, and the last one an aura.
 */
export class Tower extends Behaviour {
  kind: TowerKind = 'archer';
  /** The model, which recoils when it fires. */
  body: Object3D | null = null;
  /** Three stars over it, one lit per level. */
  stars: Object3D | null = null;
  aura: Object3D | null = null;
  sound: SoundName = 'arrow';
  /** Where shots leave from, above the node. */
  muzzle = 2.4;
  projectile: Prefab | null = null;
  /** A flash where each shot leaves: the cannon's. */
  flash: Prefab | null = null;
  /** The burst each upgrade makes. */
  upgradeBurst: Prefab | null = null;
  /** Turns its body to face its target, easing round, and fires only once it does: the cannon. */
  turns = false;
  /** How quickly it eases round: higher is snappier. */
  turnRate = 8;
  /** Degrees between the model's front and +z, the way it is turned to face. */
  facing = 0;

  level = 1;
  /** Gold spent on it so far: what selling refunds a share of. */
  invested = 0;
  pad: BuildPad | null = null;

  private cooldown = 0.4;

  get stats() {
    return TOWERS[this.kind].levels[this.level - 1]!;
  }

  get next() {
    return this.level < 3 ? TOWERS[this.kind].levels[this.level]! : null;
  }

  override start() {
    this.showLevel();
  }

  override update(dt: number) {
    this.cooldown -= dt;
    const target = this.turns || this.cooldown <= 0 ? this.pickTarget() : null;
    // Turning goes on between shots, so the barrel follows its target round.
    const off = target && this.turns ? this.turnTowards(target, dt) : 0;
    if (this.cooldown > 0 || !target || Math.abs(off) > AIMED) return;
    this.cooldown = 1 / this.stats.rate;
    this.fire(target);
  }

  /** Eases the body round towards the target: what is left to turn, in radians, after this frame. */
  private turnTowards(target: Enemy, dt: number): number {
    const body = this.body;
    if (!body) return 0;
    const to = target.node.position;
    const here = this.node.position;
    const heading = Math.atan2(to.x - here.x, to.z - here.z) - this.node.rotation.y + (this.facing * Math.PI) / 180;
    const off = Math.atan2(Math.sin(heading - body.rotation.y), Math.cos(heading - body.rotation.y));
    const step = off * (1 - Math.exp(-dt * this.turnRate));
    body.rotation.y += step;
    return off - step;
  }

  upgrade() {
    const next = this.next;
    if (!next) return;
    this.level++;
    this.invested += next.cost;
    this.showLevel();
    this.body?.getComponent(Punch)?.punch(-0.35);
    if (this.upgradeBurst) instantiate(this.upgradeBurst, { position: this.node.position.clone() });
  }

  private pickTarget(): Enemy | null {
    const here = this.node.position;
    const range = this.stats.range;
    let best: Enemy | null = null;
    for (const enemy of findObjectsOfType(Enemy)) {
      if (enemy.dead) continue;
      const p = enemy.node.position;
      if (Math.hypot(p.x - here.x, p.z - here.z) > range) continue;
      if (!best || enemy.distance > best.distance) best = enemy;
    }
    return best;
  }

  private fire(target: Enemy) {
    const from = this.node.position.clone().add(new Vector3(0, this.muzzle * (1 + (this.level - 1) * 0.1), 0));
    const shot = instantiate(this.projectile!, { position: from });
    shot.getComponent(Projectile)?.launch(target, this.stats, TOWERS[this.kind].magic);
    if (this.flash) instantiate(this.flash, { position: from });
    this.body?.getComponent(Punch)?.punch(0.16);
    findObjectOfType(Sfx)?.play(this.sound, 0.6);
  }

  private showLevel() {
    const punch = this.body?.getComponent(Punch);
    if (punch) punch.rest = 1 + (this.level - 1) * 0.1;
    this.stars?.children.forEach((star, i) => (star.visible = i < this.level));
    if (this.aura) this.aura.visible = this.level === 3;
  }
}

/** Radians short of its target a turning tower may still fire at it. */
const AIMED = 0.2;
