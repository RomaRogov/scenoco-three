import type { Behaviour } from './Behaviour.js';
import { flushDestroyed, reaches, reconcileHost, setLive, type Reach } from './lifecycle.js';
import { resolveRefs } from './init.js';
import { claimRoot, hosts, releaseRoot } from './registry.js';
import type { System, SystemType } from './System.js';
import type { Node } from './types.js';

export interface RuntimeOptions {
  /** Seconds per `fixedUpdate`. Unity's default, 0.02. */
  fixedDelta?: number;
  /** The longest frame `update` is told about, so a stall does not become a teleport. */
  maxDelta?: number;
}

/**
 * Runs the behaviours under one root. It does not own a loop: call `update(dt)` from yours.
 *
 * A behaviour is live — receiving hooks — while its node is under `root` and it is enabled.
 * That is checked when a behaviour is added, and again at the top of every `update`.
 */
export class Runtime {
  /** The runtime created last — where `instantiate` puts things when no parent is given. */
  static current: Runtime | null = null;

  readonly root: Node;
  readonly fixedDelta: number;
  readonly maxDelta: number;
  /** Game seconds so far, at the start of this frame — `Time.time`. */
  time = 0;
  /** Real seconds so far — `Time.unscaledTime`. */
  unscaledTime = 0;
  frame = 0;
  /** How fast game time runs — `Time.timeScale`. */
  timeScale = 1;
  /** This frame's seconds, scaled; `fixedDelta` while `fixedUpdate` runs — `Time.deltaTime`. */
  deltaTime = 0;
  /** This frame's real seconds — `Time.unscaledDeltaTime`. */
  unscaledDeltaTime = 0;
  /** True while `update` runs the frame, so a host can tell game code from a DOM handler. */
  updating = false;

  /**
   * @internal How far into the lifecycle behaviours go — `awake`, then `onEnable`, then `start`, then
   * the frame's own hooks, each needing the one before. A host holds a scene short of one to show it
   * as written.
   */
  reach: Reach = 'frame';

  /** @internal */ readonly live = new Set<Behaviour>();
  /** @internal */ readonly pendingStart: Behaviour[] = [];
  private readonly systems: System[] = [];
  private accumulator = 0;

  /**
   * How far the clock is between the last `fixedUpdate` and the next, 0..1 — what a system that
   * steps in `fixedUpdate` blends by in `update`, so motion stays smooth at any frame rate.
   */
  get interpolationAlpha(): number {
    return this.accumulator / this.fixedDelta;
  }

  constructor(root: Node, options: RuntimeOptions = {}) {
    claimRoot(root, this);
    this.root = root;
    this.fixedDelta = options.fixedDelta ?? 0.02;
    this.maxDelta = options.maxDelta ?? 1 / 3;
    Runtime.current = this;
  }

  /** One frame: start, fixedUpdate (as many as are due), update, coroutines, lateUpdate, destroy. */
  update(realDt: number): void {
    const unscaled = Math.min(Math.max(realDt, 0), this.maxDelta);
    const dt = unscaled * this.timeScale;
    this.unscaledDeltaTime = unscaled;
    this.deltaTime = dt;
    this.time += dt;
    this.unscaledTime += unscaled;
    this.updating = true;
    try {
      this.tick(dt, unscaled);
    } finally {
      this.updating = false;
    }
    this.frame++;
  }

  /** @internal `start` for every behaviour waiting for it: each frame, and after an edit made while the clock is held. */
  startPending(): void {
    if (!reaches(this, 'start')) return;
    for (const b of this.pendingStart.splice(0)) {
      if (this.isLive(b) && !b._started) {
        b._started = true;
        resolveRefs(b);
        b._refs = null;
        if (b.start) this.guard(b, 'start', () => b.start!());
      }
    }
  }

  private tick(dt: number, unscaled: number): void {
    for (const host of hosts) reconcileHost(host, this);

    if (!reaches(this, 'start')) return flushDestroyed();
    this.startPending();
    if (!reaches(this, 'frame')) return flushDestroyed();

    // Scaled, as in Unity: at timeScale 0 no fixedUpdate runs, and physics holds still.
    this.accumulator += dt;
    this.deltaTime = this.fixedDelta;
    while (this.accumulator >= this.fixedDelta) {
      this.accumulator -= this.fixedDelta;
      for (const b of this.snapshot()) if (this.ticks(b) && b.fixedUpdate) this.guard(b, 'fixedUpdate', () => b.fixedUpdate!(this.fixedDelta));
      for (const s of this.systems) if (s.fixedUpdate) this.guard(s, 'fixedUpdate', () => s.fixedUpdate!(this.fixedDelta));
    }
    this.deltaTime = dt;
    for (const b of this.snapshot()) if (this.ticks(b) && b.update) this.guard(b, 'update', () => b.update!(dt));
    for (const s of this.systems) if (s.update) this.guard(s, 'update', () => s.update!(dt));
    for (const b of this.snapshot()) {
      if (!this.ticks(b) || !b._coroutines) continue;
      // Over a copy, removing only what finished: a coroutine may start another mid-step
      // (`yield this.startCoroutine(…)`), and rebuilding the list would drop the newcomer.
      for (const c of b._coroutines.slice()) {
        if (!this.ticks(b)) break; // destroyed or disabled by an earlier one
        // A coroutine that throws ends there, as in Unity; the behaviour's others go on.
        if (this.guard(b, 'coroutine', () => c.step(dt, unscaled)) === true) continue;
        const i = b._coroutines?.indexOf(c) ?? -1;
        if (i !== -1) b._coroutines!.splice(i, 1);
      }
    }
    for (const b of this.snapshot()) if (this.ticks(b) && b.lateUpdate) this.guard(b, 'lateUpdate', () => b.lateUpdate!(dt));
    for (const s of this.systems) if (s.lateUpdate) this.guard(s, 'lateUpdate', () => s.lateUpdate!(dt));

    flushDestroyed();
  }

  /**
   * One hook of one behaviour or system. What it throws is logged, as Unity logs an exception, and
   * the frame goes on: one broken behaviour stops itself, not the game. A hook that throws on every
   * frame is logged once, so the console keeps saying something new.
   */
  private guard<R>(owner: object, hook: string, call: () => R): R | undefined {
    try {
      return call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const where = `${owner.constructor.name}.${hook}`;
      const seen = this.thrown.get(where);
      if (seen?.has(message)) return undefined;
      this.thrown.set(where, (seen ?? new Set()).add(message));
      const node = (owner as { _node?: Node | null })._node;
      const on = node ? ` on ${node.name ? `"${node.name}"` : `a ${node.type}`}` : '';
      console.error(`${where}${on} threw — the rest of the frame went on, as in Unity; logged once even if it repeats:`, error);
      return undefined;
    }
  }

  /** What each hook has thrown, so each error is logged once. */
  private readonly thrown = new Map<string, Set<string>>();

  /** This runtime's system of that class, made — and woken — on first ask. */
  requireSystem<T extends System>(type: SystemType<T>): T {
    const found = this.getSystem(type);
    if (found) return found;
    const created = new type();
    created.runtime = this;
    this.systems.push(created);
    created.awake?.();
    return created;
  }

  getSystem<T extends System>(type: SystemType<T>): T | null {
    return (this.systems.find((s) => s instanceof type) as T | undefined) ?? null;
  }

  /** Stop running: every live behaviour gets `onDisable`, every system `onDestroy`. */
  dispose(): void {
    for (const b of [...this.live]) setLive(b, null);
    for (const s of this.systems.splice(0)) s.onDestroy?.();
    releaseRoot(this.root);
    if (Runtime.current === this) Runtime.current = null;
  }

  private snapshot(): Behaviour[] {
    return [...this.live];
  }

  private isLive(b: Behaviour): boolean {
    return b._live === this && !b._pendingDestroy;
  }

  /** Live and started: one made mid-frame — by a handler, by `instantiate` — waits for its `start`, as in Unity. */
  private ticks(b: Behaviour): boolean {
    return b._started && this.isLive(b);
  }
}
