import { Behaviour, Event, Input, KeyCode, WaitForSeconds, findObjectOfType } from '@scenoco-three/core';

export type Phase = 'ready' | 'playing' | 'over';

const el = (id: string) => document.getElementById(id)!;

/** Run state, speed ramp, score and the HUD. */
export class Game extends Behaviour {
  baseSpeed = 14;
  maxSpeed = 38;
  acceleration = 0.4;
  idleSpeed = 7;

  phase: Phase = 'ready';
  speed = 7;
  distance = 0;
  coins = 0;
  best = 0;

  readonly onStart = new Event();
  readonly onOver = new Event();

  private canRestart = false;
  private shown = { score: -1, coins: -1 };
  private downAt: [number, number] | null = null;

  get score() {
    return Math.floor(this.distance) + this.coins * 10;
  }

  awake() {
    this.speed = this.idleSpeed;
    try {
      this.best = Number(localStorage.getItem('rail-rush-best')) || 0;
    } catch {
      this.best = 0;
    }
    el('best').textContent = String(this.best);
  }

  onEnable() {
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
  }

  onDisable() {
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    this.downAt = [e.clientX, e.clientY];
  };

  private onUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 14) return;
    if (this.phase === 'ready' || (this.phase === 'over' && this.canRestart)) this.begin();
  };

  update(dt: number) {
    const wantsGo =
      Input.getButtonDown('Start') || Input.getButtonDown('Restart') || Input.getKeyDown(KeyCode.Return);
    if (this.phase === 'ready' && (wantsGo || Input.getKeyDown(KeyCode.Space))) this.begin();
    else if (this.phase === 'over' && this.canRestart && (wantsGo || Input.getKeyDown(KeyCode.Space) || Input.getKeyDown(KeyCode.R))) this.begin();

    if (this.phase === 'playing') {
      this.speed = Math.min(this.maxSpeed, this.speed + this.acceleration * dt);
      this.distance += this.speed * dt;
    }
    this.refreshHud();
  }

  begin() {
    this.phase = 'playing';
    this.speed = this.baseSpeed;
    this.distance = 0;
    this.coins = 0;
    this.canRestart = false;
    this.shown = { score: -1, coins: -1 };
    el('title').classList.add('hidden');
    el('over').classList.add('hidden');
    document.body.classList.add('running');
    this.onStart.emit();
  }

  addCoin() {
    this.coins++;
    const c = el('coins-box');
    c.classList.remove('bump');
    void c.offsetWidth;
    c.classList.add('bump');
  }

  crash() {
    if (this.phase !== 'playing') return;
    this.phase = 'over';
    this.speed = 0;
    if (this.score > this.best) {
      this.best = this.score;
      try {
        localStorage.setItem('rail-rush-best', String(this.best));
      } catch {
        /* storage may be blocked */
      }
    }
    this.onOver.emit();
    this.startCoroutine(this.showOver());
  }

  private *showOver() {
    yield new WaitForSeconds(0.9);
    el('final').textContent = String(this.score);
    el('final-coins').textContent = String(this.coins);
    el('final-dist').textContent = `${Math.floor(this.distance)} m`;
    el('best').textContent = String(this.best);
    el('over').classList.remove('hidden');
    document.body.classList.remove('running');
    this.canRestart = true;
  }

  private refreshHud() {
    if (this.shown.score !== this.score) {
      this.shown.score = this.score;
      el('score').textContent = String(this.score);
    }
    if (this.shown.coins !== this.coins) {
      this.shown.coins = this.coins;
      el('coins').textContent = String(this.coins);
    }
  }
}

export const getGame = () => findObjectOfType(Game);
