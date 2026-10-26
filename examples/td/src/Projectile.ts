import { Vector3 } from 'three';
import { Behaviour, destroy, findObjectOfType, findObjectsOfType, instantiate, type Prefab } from '@scenoco-three/core';
import type { TowerLevel } from './data';
import { CameraRig } from './CameraRig';
import { Enemy } from './Enemy';
import { Sfx, type SoundName } from './Sfx';


/**
 * A shot in flight. `lob` shots (arrows, shells) fly a ballistic arc to where the target will be
 * and always land; `homing` ones (bolts, shards) chase the target. Either way the hit happens where
 * it lands: splash on everything near, a slow, or the target alone.
 */
export class Projectile extends Behaviour {
  flight: 'lob' | 'homing' = 'lob';
  /** Units per second over the ground. */
  speed = 14;
  /** Arc height as a share of the distance (lob). */
  arc = 0.12;
  /** Tumbles as it flies: a cannonball. */
  spin = 0;
  /** The burst where it lands. */
  hit: Prefab | null = null;
  hitSound: SoundName | null = null;
  /** Shakes the camera this much on landing. */
  shake = 0;

  private target: Enemy | null = null;
  private stats: TowerLevel | null = null;
  private magic = false;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private duration = 1;
  private elapsed = 0;
  private height = 1;
  private readonly last = new Vector3();

  launch(target: Enemy, stats: TowerLevel, magic: boolean) {
    this.target = target;
    this.stats = stats;
    this.magic = magic;
    this.from.copy(this.node.position);
    const distance = this.from.distanceTo(target.aimPoint(new Vector3()));
    this.duration = Math.max(0.18, distance / this.speed);
    // Lead the target: where it will be when this lands.
    target.positionIn(this.duration, this.to);
    this.to.y += target.aim;
    this.height = Math.max(0.6, distance * this.arc);
    this.last.copy(this.from);
  }

  override update(dt: number) {
    if (!this.stats) return;
    this.elapsed += dt;
    if (this.flight === 'homing') this.chase(dt);
    else this.lob();
    if (this.spin) this.node.rotation.x += this.spin * dt;
  }

  private lob() {
    const u = Math.min(1, this.elapsed / this.duration);
    const p = this.node.position.lerpVectors(this.from, this.to, u);
    p.y += 4 * this.height * u * (1 - u);
    if (!this.spin && p.distanceToSquared(this.last) > 1e-6) this.node.lookAt(this.last.clone().lerp(p, 2));
    this.last.copy(p);
    if (u >= 1) this.land(this.target && !this.target.dead ? this.target : null);
  }

  private chase(dt: number) {
    const target = this.target;
    if (target && !target.dead) target.aimPoint(this.to);
    const p = this.node.position;
    const step = this.speed * dt;
    const gap = this.to.clone().sub(p);
    if (gap.length() <= step) {
      p.copy(this.to);
      this.land(target && !target.dead ? target : null);
      return;
    }
    p.addScaledVector(gap.normalize(), step);
    this.node.lookAt(this.to);
  }

  private land(target: Enemy | null) {
    const stats = this.stats!;
    this.stats = null;
    const at = this.node.position.clone();
    if (this.hit) instantiate(this.hit, { position: at });
    if (this.hitSound) findObjectOfType(Sfx)?.play(this.hitSound, 0.7);
    if (this.shake) findObjectOfType(CameraRig)?.shake(this.shake);
    const splash = stats.splash ?? 0;
    const strike = (enemy: Enemy) => {
      enemy.takeDamage(stats.damage, this.magic);
      if (stats.slow) enemy.slow(stats.slow, stats.slowFor ?? 1);
    };
    if (splash > 0) {
      for (const enemy of findObjectsOfType(Enemy)) {
        const p = enemy.node.position;
        if (!enemy.dead && Math.hypot(p.x - at.x, p.z - at.z) <= splash) strike(enemy);
      }
    } else if (target) {
      strike(target);
    }
    destroy(this.node);
  }
}
