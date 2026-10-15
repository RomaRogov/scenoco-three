import { Behaviour, Time } from '@scenoco-three/core';
import { MathUtils, type Object3D, type PerspectiveCamera } from 'three';
import { Game, getGame } from './Game';

/** Sits behind and above the runner, leans after lane changes, kicks its fov out with speed. */
export class ChaseCamera extends Behaviour<PerspectiveCamera> {
  target: Object3D | null = null;
  private game: Game | null = null;
  private shake = 0;

  start() {
    this.game = getGame();
    if (this.game) this.listen(this.game.onOver, () => (this.shake = 0.45));
  }

  lateUpdate(dt: number) {
    if (!this.target) return;
    const t = this.target.position;
    const k = 1 - Math.exp(-8 * dt);
    const p = this.node.position;
    p.x += (t.x * 0.6 - p.x) * k;
    p.y += (4.4 + t.y * 0.35 - p.y) * k;
    p.z = 7.6;
    this.shake = Math.max(0, this.shake - dt);
    if (this.shake > 0) {
      p.x += Math.sin(Time.time * 90) * this.shake * 0.5;
      p.y += Math.cos(Time.time * 77) * this.shake * 0.4;
    }
    this.node.lookAt(t.x * 0.35, 1.5, -12);
    const speedT = this.game ? (this.game.speed - 7) / 31 : 0;
    this.node.fov = MathUtils.lerp(this.node.fov, 60 + speedT * 12, k);
    this.node.updateProjectionMatrix();
  }
}
