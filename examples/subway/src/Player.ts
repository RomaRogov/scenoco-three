import { Behaviour, Input, KeyCode, destroy, findObjectsOfType } from '@scenoco-three/core';
import { MathUtils, Vector3, type Group } from 'three';
import { Coin } from './Coin';
import { Game, getGame } from './Game';
import { Obstacle } from './Obstacle';

type Move = 'left' | 'right' | 'jump' | 'roll';

/** The runner: three lanes, jump, roll, keys and swipes, and what it touches. */
export class Player extends Behaviour<Group> {
  laneWidth = 2.4;
  jumpHeight = 2.3;
  gravity = 62;
  rollTime = 0.65;

  model: Group | null = null;
  legL: Group | null = null;
  legR: Group | null = null;
  armL: Group | null = null;
  armR: Group | null = null;

  lane = 0;
  rolling = false;
  grounded = true;

  private game: Game | null = null;
  private vy = 0;
  private rollLeft = 0;
  private phase = 0;
  private crashed = false;
  private crashT = 0;
  private swipe: { x: number; y: number } | null = null;
  private queue: Move[] = [];
  private tmp = new Vector3();

  start() {
    this.game = getGame();
    if (this.game) {
      this.listen(this.game.onStart, () => this.reset());
      this.listen(this.game.onOver, () => (this.crashed = true));
    }
  }

  onEnable() {
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  onDisable() {
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    this.swipe = { x: e.clientX, y: e.clientY };
  };

  private onMove = (e: PointerEvent) => {
    const s = this.swipe;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    if (Math.abs(dx) > Math.abs(dy)) this.queue.push(dx < 0 ? 'left' : 'right');
    else this.queue.push(dy < 0 ? 'jump' : 'roll');
    this.swipe = { x: e.clientX, y: e.clientY };
  };

  private onUp = () => {
    this.swipe = null;
  };

  private reset() {
    this.lane = 0;
    this.rolling = false;
    this.grounded = true;
    this.vy = 0;
    this.crashed = false;
    this.crashT = 0;
    this.queue.length = 0;
    this.node.position.set(0, 0, 0);
    if (this.model) {
      this.model.rotation.set(0, 0, 0);
      this.model.scale.set(1, 1, 1);
      this.model.position.set(0, 0, 0);
    }
  }

  update(dt: number) {
    const g = this.game;
    if (!g) return;
    const playing = g.phase === 'playing';

    if (playing) {
      if (Input.getKeyDown(KeyCode.LeftArrow) || Input.getKeyDown(KeyCode.A)) this.queue.push('left');
      if (Input.getKeyDown(KeyCode.RightArrow) || Input.getKeyDown(KeyCode.D)) this.queue.push('right');
      if (Input.getKeyDown(KeyCode.UpArrow) || Input.getKeyDown(KeyCode.W) || Input.getKeyDown(KeyCode.Space)) this.queue.push('jump');
      if (Input.getKeyDown(KeyCode.DownArrow) || Input.getKeyDown(KeyCode.S)) this.queue.push('roll');
      for (const m of this.queue) this.apply(m);
    }
    this.queue.length = 0;

    const p = this.node.position;
    if (!this.crashed) {
      p.x += (this.lane * this.laneWidth - p.x) * (1 - Math.exp(-20 * dt));
      if (!this.grounded) {
        this.vy -= this.gravity * dt;
        p.y += this.vy * dt;
        if (p.y <= 0) {
          p.y = 0;
          this.vy = 0;
          this.grounded = true;
        }
      }
      if (this.rolling) {
        this.rollLeft -= dt;
        if (this.rollLeft <= 0 && this.grounded) this.rolling = false;
      }
      if (playing) this.collide();
    }
    this.animate(dt, g);
  }

  private apply(m: Move) {
    if (m === 'left') this.lane = Math.max(-1, this.lane - 1);
    else if (m === 'right') this.lane = Math.min(1, this.lane + 1);
    else if (m === 'jump' && this.grounded) {
      this.vy = Math.sqrt(2 * this.gravity * this.jumpHeight);
      this.grounded = false;
      this.rolling = false;
    } else if (m === 'roll') {
      this.rolling = true;
      this.rollLeft = this.rollTime;
      if (!this.grounded) this.vy = Math.min(this.vy, -26);
    }
  }

  private collide() {
    const p = this.node.position;
    const y0 = p.y;
    const y1 = p.y + (this.rolling ? 0.8 : 1.8);
    for (const o of findObjectsOfType(Obstacle)) {
      o.node.getWorldPosition(this.tmp);
      if (Math.abs(this.tmp.z) > o.halfZ + 0.3) continue;
      if (Math.abs(this.tmp.x - p.x) > o.halfX + 0.3) continue;
      if (y1 <= o.yMin || y0 >= o.yMax) continue;
      this.game!.crash();
      return;
    }
    const cy = y0 + (this.rolling ? 0.4 : 0.95);
    for (const c of findObjectsOfType(Coin)) {
      c.node.getWorldPosition(this.tmp);
      if (Math.abs(this.tmp.z) > 0.9 || Math.abs(this.tmp.x - p.x) > 0.9 || Math.abs(this.tmp.y - cy) > 1.05) continue;
      this.game!.addCoin();
      destroy(c.node);
    }
  }

  private animate(dt: number, g: Game) {
    const m = this.model;
    if (!m) return;
    const p = this.node.position;
    if (this.crashed) {
      this.crashT += dt;
      const k = Math.min(1, this.crashT / 0.35);
      m.rotation.x = MathUtils.lerp(m.rotation.x, 1.35, 1 - Math.exp(-12 * dt));
      m.position.y = Math.sin(k * Math.PI) * 0.4;
      return;
    }
    this.phase += dt * (9 + g.speed * 0.4);
    const swing = Math.sin(this.phase);
    const air = !this.grounded;
    const k = 1 - Math.exp(-18 * dt);
    const set = (o: Group | null, x: number) => o && (o.rotation.x += (x - o.rotation.x) * k);
    set(this.legL, air ? -0.9 : swing * 0.95);
    set(this.legR, air ? 0.5 : -swing * 0.95);
    set(this.armL, air ? -2.4 : -swing * 0.9);
    set(this.armR, air ? -2.4 : swing * 0.9);
    const targetScaleY = this.rolling ? 0.5 : 1;
    m.scale.y += (targetScaleY - m.scale.y) * k;
    m.rotation.x += ((this.rolling ? -0.55 : air ? -0.15 : -0.08) - m.rotation.x) * k;
    m.rotation.z += (((this.lane * this.laneWidth - p.x) * -0.18) - m.rotation.z) * k;
    m.position.y = this.grounded && !this.rolling ? Math.abs(swing) * 0.07 : 0;
  }
}
