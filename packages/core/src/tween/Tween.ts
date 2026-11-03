import type { Color, Object3D, Quaternion, Vector2, Vector3, Vector4 } from 'three';
import { Behaviour } from '../kernel/Behaviour.js';
import { WaitUntil } from '../kernel/Coroutine.js';
import { runtimeOf } from '../kernel/registry.js';
import { Runtime } from '../kernel/runtime.js';
import { System } from '../kernel/System.js';
import { Ease, type EaseFunction } from './Ease.js';

/** What a tween can move. */
export type Tweenable = number | Vector2 | Vector3 | Vector4 | Color | Quaternion;

/** What each loop starts from. `Incremental` carries on from where the last one ended. */
export const LoopType = { Restart: 0, Yoyo: 1, Incremental: 2 } as const;
export type LoopType = (typeof LoopType)[keyof typeof LoopType];

/** Runs every tween of one game: after the behaviours' `update`, before their coroutines. */
class Tweens extends System {
  readonly all: Tween[] = [];
  override update(): void {
    const { frame, deltaTime, unscaledDeltaTime } = this.runtime;
    for (const tween of this.all.slice()) {
      if (tween.alive && !tween.parent && tween.playing && tween.born !== frame) tween.advance(tween.unscaled ? unscaledDeltaTime : deltaTime);
    }
    if (this.all.some((t) => !t.alive)) {
      const left = this.all.filter((t) => t.alive);
      this.all.length = 0;
      this.all.push(...left);
    }
  }
}

function tweens(): Tweens {
  if (!Runtime.current) throw new Error('A tween needs a running game: start it from awake or later.');
  return Runtime.current.requireSystem(Tweens);
}

function mix<T extends Tweenable>(from: T, to: T, t: number, out: T): T {
  if (typeof from === 'number') return (from + ((to as number) - from) * t) as T;
  const o = out as unknown as { isQuaternion?: boolean; isColor?: boolean; slerpQuaternions(a: T, b: T, t: number): void; lerpColors(a: T, b: T, t: number): void; lerpVectors(a: T, b: T, t: number): void };
  if (o.isQuaternion) o.slerpQuaternions(from, to, t);
  else if (o.isColor) o.lerpColors(from, to, t);
  else o.lerpVectors(from, to, t);
  return out;
}

function sum<T extends Tweenable>(a: T, b: T): T {
  if (typeof a === 'number') return (a + (b as number)) as T;
  if ((a as Quaternion).isQuaternion) return (a as Quaternion).clone().multiply(b as Quaternion) as T;
  return (a as Vector3).clone().add(b as Vector3) as T;
}

const copy = <T extends Tweenable>(value: T): T => (typeof value === 'number' ? value : ((value as Vector3).clone() as T));

/**
 * A value moving over time, on the game's clock: it stops at `timeScale` 0 and steps exactly under
 * a held clock. It starts by itself and is spent when it ends. Everything set on it returns it, so
 * settings chain. A tween on a node ends when the node leaves the game; `setLink` ties any other to
 * a node or a behaviour.
 */
export class Tween {
  /** @internal */ duration: number;
  private readonly begin: (self: Tween) => (eased: number) => void;
  /** @internal */ alive = true;
  /** @internal */ playing = true;
  /** @internal */ parent: Sequence | null = null;
  /** @internal */ unscaled = false;
  /** @internal */ readonly born: number;
  /** Speed of this tween: 2 is twice as fast. */
  timeScale = 1;

  protected ease: EaseFunction = Ease.OutQuad;
  /** @internal */ relative = false;
  /** @internal */ delay = 0;
  /** @internal */ loops = 1;
  protected loopType: LoopType = LoopType.Restart;
  private target: object | null = null;
  private link: Object3D | Behaviour | null = null;
  private autoKill = true;
  private time = 0;
  private begun = false;
  private ended = false;
  private apply: ((eased: number) => void) | null = null;
  private reverse: ((value?: never) => void) | null = null;
  private startFn: (() => void) | null = null;
  private updateFn: (() => void) | null = null;
  private stepFn: (() => void) | null = null;
  private completeFn: (() => void) | null = null;
  private cycleDone = 0;
  private killFn: (() => void) | null = null;

  /** @internal `begin` reads where the value is, when the tween first runs, and returns what moves it. */
  constructor(duration: number, begin: (self: Tween) => (eased: number) => void) {
    this.duration = duration;
    this.begin = begin;
    const system = tweens();
    this.born = system.runtime.frame;
    system.all.push(this);
  }

  /** The curve it follows; `Ease.OutQuad` unless set. */
  setEase(ease: EaseFunction): this {
    this.ease = ease;
    return this;
  }
  /** Seconds to wait before it starts. */
  setDelay(seconds: number): this {
    this.delay = seconds;
    return this;
  }
  /** How many times it runs, -1 for ever. */
  setLoops(loops: number, type: LoopType = LoopType.Restart): this {
    this.loops = loops;
    this.loopType = type;
    return this;
  }
  /** Its end value is added to where it starts, rather than being where it ends. */
  setRelative(relative = true): this {
    this.relative = relative;
    return this;
  }
  /** `true`: on real time, so a pause does not stop it. */
  setUpdate(unscaled: boolean): this {
    this.unscaled = unscaled;
    return this;
  }
  /** It ends when this node leaves the game, or this behaviour is destroyed. */
  setLink(link: Object3D | Behaviour): this {
    this.link = link;
    return this;
  }
  /** `false`: it stays when it ends, for `restart`. Then `kill` it when done with it. */
  setAutoKill(autoKill: boolean): this {
    this.autoKill = autoKill;
    return this;
  }
  /** What `Tween.kill(target)` finds it by. */
  setTarget(target: object): this {
    this.target = target;
    return this;
  }
  /** Runs from the given value, or from its end value, to where the value is now. */
  from(value?: Tweenable): this {
    this.reverse?.(value as never);
    return this;
  }

  onStart(fn: () => void): this {
    this.startFn = fn;
    return this;
  }
  onUpdate(fn: () => void): this {
    this.updateFn = fn;
    return this;
  }
  /** Each time a loop ends, the last one included. */
  onStepComplete(fn: () => void): this {
    this.stepFn = fn;
    return this;
  }
  onComplete(fn: () => void): this {
    this.completeFn = fn;
    return this;
  }
  onKill(fn: () => void): this {
    this.killFn = fn;
    return this;
  }

  pause(): this {
    this.playing = false;
    return this;
  }
  play(): this {
    this.playing = true;
    return this;
  }
  /** From the top, with its delay. */
  restart(): this {
    this.time = 0;
    this.cycleDone = 0;
    this.seek(0);
    this.playing = true;
    return this;
  }
  /** To its end, now. */
  complete(): this {
    if (this.loops >= 0) this.seek(this.delay + this.duration * this.loops);
    return this;
  }
  /** Stop it where it is, or at its end with `complete`. A spent tween cannot be used again. */
  kill(complete = false): void {
    if (!this.alive) return;
    if (complete) this.complete();
    this.alive = false;
    this.killFn?.();
  }
  isActive(): boolean {
    return this.alive;
  }
  isPlaying(): boolean {
    return this.alive && this.playing;
  }
  /** In a coroutine: `yield tween.waitForCompletion()`. Goes on if the tween is killed too. */
  waitForCompletion(): WaitUntil {
    return new WaitUntil(() => !this.alive || this.ended);
  }

  /** @internal */
  advance(dt: number): void {
    this.time += dt * this.timeScale;
    this.seek(this.time);
    if (this.ended && this.autoKill && this.alive) this.kill();
  }

  /** @internal to `time` seconds in, its delay included. */
  seek(time: number): void {
    if (this.alive && this.link && (this.link instanceof Behaviour ? this.link.isDestroyed : !runtimeOf(this.link))) return this.kill();
    const t = time - this.delay;
    if (t < 0) {
      if (this.begun) this.render(0, 0);
      this.begun = this.ended = false;
      return;
    }
    const total = this.loops < 0 ? Infinity : this.duration * this.loops;
    const at = Math.min(t, total);
    if (this.ended && at >= total) return;
    this.ended = false;
    if (!this.begun) {
      this.begun = true;
      this.apply ??= this.begin(this);
      this.startFn?.();
    }
    const cycle = this.duration > 0 ? Math.min(Math.floor(at / this.duration), this.loops < 0 ? Infinity : this.loops - 1) : 0;
    this.render(this.duration > 0 ? at / this.duration - cycle : 1, cycle);
    this.updateFn?.();
    for (; this.cycleDone < cycle; this.cycleDone++) this.stepFn?.();
    if (t >= total) {
      this.ended = true;
      this.stepFn?.();
      this.completeFn?.();
    }
  }

  /** `part` 0..1 of a loop, `cycle` which loop. */
  protected render(part: number, cycle: number): void {
    const backwards = this.loopType === LoopType.Yoyo && cycle % 2 === 1;
    const eased = this.ease(backwards ? 1 - part : part);
    this.apply?.(this.loopType === LoopType.Incremental ? cycle + eased : eased);
  }

  /** Any value, by how to read and how to write it: `Tween.to(() => hp, (v) => (hp = v), 0, 0.5)`. */
  static to<T extends Tweenable>(get: () => T, set: (value: T) => void, to: T, duration: number): Tween {
    let end = to;
    const tween = new Tween(duration, (self) => {
      const from = copy(get());
      const target = self.relative ? sum(from, end) : end;
      const out = copy(from);
      return (eased) => set(mix(from, target, eased, out));
    });
    tween.reverse = (value) => {
      const now = copy(get());
      set((value as unknown as T | undefined) ?? end);
      end = now;
    };
    return tween;
  }

  /** A number from one value to another, handed to `fn`. */
  static float(from: number, to: number, duration: number, fn: (value: number) => void): Tween {
    return new Tween(duration, () => (eased) => fn(from + (to - from) * eased));
  }

  /** `fn` once, `seconds` from now, on the game's clock. */
  static delayedCall(seconds: number, fn: () => void): Tween {
    return new Tween(seconds, () => () => {}).onComplete(fn);
  }

  /** Tweens one after another and side by side, moved as one. */
  static sequence(): Sequence {
    return new Sequence();
  }

  /** End every tween of this target: a node, a material, what `setTarget` said. */
  static kill(target: object, complete = false): void {
    for (const tween of tweens().all.slice()) if (tween.target === target) tween.kill(complete);
  }

  /** End every tween. */
  static killAll(complete = false): void {
    for (const tween of tweens().all.slice()) if (!tween.parent) tween.kill(complete);
  }
}

/** Tweens on one timeline. What goes in stops running by itself and runs from here. */
export class Sequence extends Tween {
  private readonly items: { at: number; tween: Tween }[] = [];
  private cursor = 0;
  private lastStart = 0;
  private lastCycle = 0;

  constructor() {
    super(0, () => () => {});
    this.ease = Ease.Linear;
  }

  private place(at: number, tween: Tween): this {
    tween.parent = this;
    this.items.push({ at, tween });
    this.items.sort((a, b) => a.at - b.at);
    this.duration = Math.max(this.duration, at + spanOf(tween));
    return this;
  }

  /** After everything so far. */
  append(tween: Tween): this {
    this.lastStart = this.cursor;
    this.place(this.cursor, tween);
    this.cursor += spanOf(tween);
    return this;
  }
  /** Before everything so far, which moves along to make room. */
  prepend(tween: Tween): this {
    const span = spanOf(tween);
    for (const item of this.items) item.at += span;
    this.cursor += span;
    this.duration += span;
    this.lastStart = 0;
    return this.place(0, tween);
  }
  /** Alongside what was added last. */
  join(tween: Tween): this {
    this.place(this.lastStart, tween);
    this.cursor = Math.max(this.cursor, this.lastStart + spanOf(tween));
    return this;
  }
  /** At a time of its own, in seconds from the start. */
  insert(at: number, tween: Tween): this {
    this.place(at, tween);
    this.cursor = Math.max(this.cursor, at + spanOf(tween));
    return this;
  }
  appendInterval(seconds: number): this {
    this.lastStart = this.cursor;
    this.cursor += seconds;
    this.duration = Math.max(this.duration, this.cursor);
    return this;
  }
  appendCallback(fn: () => void): this {
    return this.insertCallback(this.cursor, fn);
  }
  insertCallback(at: number, fn: () => void): this {
    return this.place(at, new Tween(0, () => () => {}).onStart(fn));
  }

  override kill(complete = false): void {
    if (!this.alive) return;
    super.kill(complete);
    for (const { tween } of this.items) tween.kill();
  }

  protected override render(part: number, cycle: number): void {
    const backwards = this.loopType === LoopType.Yoyo && cycle % 2 === 1;
    if (cycle !== this.lastCycle && !backwards && this.loopType !== LoopType.Yoyo) {
      // The last loop to its end, then all of it back to the top.
      for (const { tween } of this.items) tween.seek(Infinity);
      for (const { tween } of [...this.items].reverse()) tween.seek(-1);
    }
    this.lastCycle = cycle;
    const position = this.ease(backwards ? 1 - part : part) * this.duration;
    for (const { at, tween } of this.items) if (tween.alive) tween.seek(position - at);
  }
}

function spanOf(tween: Tween): number {
  return tween.delay + tween.duration * Math.max(tween.loops, 1);
}
