import { type Object3D, Vector3 } from 'three';
import { Behaviour, destroy, findObjectOfType, instantiate, type Prefab } from '@scenoco-three/core';
import { SplineContainer } from '@scenoco-three/splines';
import { ENEMIES, type EnemyKind } from './data';
import { Game } from './Game';
import { HealthBar } from './HealthBar';
import { Sfx } from './Sfx';
import { Terrain } from '@scenoco-three/terrain';
import { groundAt } from './ground';


/** How each kind moves: hops a stride, its height, the sway, and a pitch for a bounding run. */
const GAITS: Record<EnemyKind, { stride: number; hop: number; sway: number; pitch: number }> = {
  goblin: { stride: 0.55, hop: 0.13, sway: 0.16, pitch: 0 },
  wolf: { stride: 1.1, hop: 0.16, sway: 0.04, pitch: 0.18 },
  orc: { stride: 0.8, hop: 0.07, sway: 0.12, pitch: 0 },
  troll: { stride: 1.2, hop: 0.06, sway: 0.1, pitch: 0 },
};

/**
 * Walks the level's path to the castle. Health, armour, a slow from frost, and a death that pays.
 * Its hop is locked to the distance walked, so a slowed enemy visibly trudges.
 */
export class Enemy extends Behaviour {
  kind: EnemyKind = 'goblin';
  /** The model, which hops and sways; this node follows the path. */
  body: Object3D | null = null;
  /** Ice motes shown while slowed. */
  chill: Object3D | null = null;
  /** The puff it leaves when it dies. */
  puff: Prefab | null = null;
  /** Height an arrow aims at. */
  aim = 0.6;

  /** Set by the spawner before start: the level's health multiplier for this wave. */
  toughness = 1;

  hp = 1;
  maxHp = 1;
  /** Units walked along the path: how far ahead it is, for towers choosing a target. */
  distance = 0;
  dead = false;

  private path: SplineContainer | null = null;
  private terrain: Terrain | null = null;
  private length = 1;
  private lane = 0;
  private slowFactor = 1;
  private slowLeft = 0;
  private hitKick = 0;
  private readonly forward = new Vector3();

  get spec() {
    return ENEMIES[this.kind];
  }

  get speed() {
    return this.spec.speed * this.slowFactor;
  }

  /** 0 at the cave, 1 at the castle. */
  get progress() {
    return this.distance / this.length;
  }

  // On the path in awake, which instantiate runs: by start the frame it was made in has been drawn,
  // with it wherever the prefab put it.
  override awake() {
    this.path = findObjectOfType(SplineContainer);
    this.terrain = findObjectOfType(Terrain);
    this.length = this.path?.calculateLength() ?? 1;
    // A lane of its own across the road, so a crowd spreads out instead of stacking up.
    this.lane = (Math.random() * 2 - 1) * 0.45;
    if (this.path) this.place(0);
  }

  override start() {
    this.maxHp = this.hp = Math.round(this.spec.hp * this.toughness);
  }

  override update(dt: number) {
    if (this.dead || !this.path) return;
    if (this.slowLeft > 0) {
      this.slowLeft -= dt;
      if (this.slowLeft <= 0) this.slowFactor = 1;
    }
    if (this.chill) this.chill.visible = this.slowLeft > 0;
    this.distance += this.speed * dt;
    if (this.distance >= this.length) {
      this.dead = true;
      findObjectOfType(Game)?.enemyEscaped(this);
      destroy(this.node);
      return;
    }
    this.place(dt);
    this.animate(dt);
  }

  /** Where it will be in `seconds`, at its current speed: what a cannon aims at. */
  positionIn(seconds: number, target = new Vector3()): Vector3 {
    if (!this.path) return target.copy(this.node.position);
    const t = Math.min(1, (this.distance + this.speed * seconds) / this.length);
    this.path.evaluatePosition(t, target);
    target.y = this.terrain ? groundAt(this.terrain, target.x, target.z) : target.y;
    return target;
  }

  /** The point projectiles fly at. */
  aimPoint(target = new Vector3()): Vector3 {
    return target.copy(this.node.position).setY(this.node.position.y + this.aim);
  }

  takeDamage(amount: number, magic: boolean) {
    if (this.dead) return;
    const dealt = magic ? amount : amount * (1 - this.spec.armor);
    this.hp -= dealt;
    this.hitKick = 1;
    this.getComponentInChildren(HealthBar)?.set(this.hp / this.maxHp);
    if (this.hp <= 0) this.die();
  }

  /** Slowed to `factor` of its speed for `seconds`; a stronger slow replaces a weaker one. */
  slow(factor: number, seconds: number) {
    if (factor <= this.slowFactor || this.slowLeft <= 0) this.slowFactor = factor;
    this.slowLeft = Math.max(this.slowLeft, seconds);
  }

  private die() {
    this.dead = true;
    if (this.puff) instantiate(this.puff, { position: this.node.position.clone() });
    findObjectOfType(Sfx)?.play('death', 0.5);
    findObjectOfType(Game)?.enemyKilled(this);
    destroy(this.node);
  }

  /** On the path at its distance; `dt` 0 snaps its heading, otherwise it turns into bends smoothly. */
  private place(dt: number) {
    const path = this.path!;
    const t = this.distance / this.length;
    path.evaluatePosition(t, this.node.position);
    path.evaluateTangent(t, this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    // Its lane: sideways from the centre line.
    this.node.position.x += -this.forward.z * this.lane;
    this.node.position.z += this.forward.x * this.lane;
    const p = this.node.position;
    p.y = this.terrain ? groundAt(this.terrain, p.x, p.z) : 0;
    const heading = Math.atan2(this.forward.x, this.forward.z);
    const turn = Math.atan2(Math.sin(heading - this.node.rotation.y), Math.cos(heading - this.node.rotation.y));
    this.node.rotation.y += dt === 0 ? turn : turn * Math.min(1, dt * 8);
  }

  private animate(dt: number) {
    const body = this.body;
    if (!body) return;
    const gait = GAITS[this.kind];
    const phase = (this.distance / gait.stride) * Math.PI;
    body.position.y = Math.abs(Math.sin(phase)) * gait.hop;
    body.rotation.z = Math.sin(phase) * gait.sway;
    body.rotation.x = Math.sin(phase * 2) * gait.pitch;
    // A flinch when hit: a quick squash that fades.
    this.hitKick = Math.max(0, this.hitKick - dt * 6);
    const k = this.hitKick;
    body.scale.set(1 + k * 0.18, 1 - k * 0.2, 1 + k * 0.18);
  }
}
