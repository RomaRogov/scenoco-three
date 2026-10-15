/**
 * Unity's yield instructions. A coroutine `yield`s one to say what it waits for:
 *
 * ```ts
 * *spawnWaves() {
 *   while (true) {
 *     yield new WaitForSeconds(2);                  // game time: stops while Time.timeScale is 0
 *     yield new WaitUntil(() => this.alive === 0);  // checked once a frame, after update
 *   }
 * }
 * ```
 *
 * `null` waits one frame; another `Coroutine` waits for it to finish; a promise waits for it to
 * settle (and its rejection is thrown at the `yield`).
 */
export abstract class YieldInstruction {}

/** Waits this many seconds of game time — scaled by `Time.timeScale`, so a paused game waits. */
export class WaitForSeconds extends YieldInstruction {
  readonly seconds: number;

  constructor(seconds: number) {
    super();
    this.seconds = seconds;
  }
}

/** Waits this many real seconds, whatever `Time.timeScale` is — a pause menu's own animations. */
export class WaitForSecondsRealtime extends YieldInstruction {
  readonly seconds: number;

  constructor(seconds: number) {
    super();
    this.seconds = seconds;
  }
}

/** Waits until the predicate is true. Checked once a frame, after every `update`. */
export class WaitUntil extends YieldInstruction {
  readonly predicate: () => boolean;

  constructor(predicate: () => boolean) {
    super();
    this.predicate = predicate;
  }
}

/** Waits while the predicate is true. Checked once a frame, after every `update`. */
export class WaitWhile extends YieldInstruction {
  readonly predicate: () => boolean;

  constructor(predicate: () => boolean) {
    super();
    this.predicate = predicate;
  }
}

/** Unity's `CustomYieldInstruction`: extend it, and the coroutine waits while `keepWaiting` is true. */
export abstract class CustomYieldInstruction extends YieldInstruction {
  abstract get keepWaiting(): boolean;
}

/** What a coroutine may yield. */
export type Yieldable = null | undefined | YieldInstruction | Coroutine | PromiseLike<unknown>;

/** A running coroutine — what `startCoroutine` returns, and something another coroutine may `yield`. */
export class Coroutine {
  /** Seconds left of a `WaitForSeconds` (game time) or a `WaitForSecondsRealtime`. */
  private seconds = 0;
  private realtime = false;
  /** A condition checked every frame: `WaitUntil`, `WaitWhile`, a custom instruction, a coroutine. */
  private waiting: (() => boolean) | null = null;
  private pending: { done: boolean; value?: unknown; error?: unknown; failed?: boolean } | null = null;
  private stopped = false;

  private readonly body: Generator<Yieldable, unknown, unknown>;

  constructor(body: Generator<Yieldable, unknown, unknown>) {
    this.body = body;
  }

  get isDone(): boolean {
    return this.stopped;
  }

  stop(): void {
    this.stopped = true;
  }

  /** Advance by one frame of `dt` game seconds and `unscaledDt` real ones. Returns false once finished. */
  step(dt: number, unscaledDt = dt): boolean {
    if (this.stopped) return false;
    let input: unknown;
    if (this.pending) {
      if (!this.pending.done) return true;
      const { value, error, failed } = this.pending;
      this.pending = null;
      if (failed) return this.resume(() => this.body.throw(error));
      input = value;
    } else if (this.waiting) {
      if (this.waiting()) return true;
      this.waiting = null;
    } else if (this.seconds > 0) {
      this.seconds -= this.realtime ? unscaledDt : dt;
      // An epsilon, so sixty steps of 1/60 add up to a second despite floating point.
      if (this.seconds > 1e-9) return true;
    }
    return this.resume(() => this.body.next(input));
  }

  private resume(advance: () => IteratorResult<Yieldable, unknown>): boolean {
    const result = advance();
    if (result.done) {
      this.stopped = true;
      return false;
    }
    this.wait(result.value);
    return true;
  }

  private wait(value: Yieldable): void {
    if (value == null) return;
    if (value instanceof WaitForSeconds || value instanceof WaitForSecondsRealtime) {
      this.seconds = value.seconds;
      this.realtime = value instanceof WaitForSecondsRealtime;
    } else if (value instanceof WaitUntil) {
      this.waiting = () => !value.predicate();
    } else if (value instanceof WaitWhile) {
      this.waiting = () => value.predicate();
    } else if (value instanceof CustomYieldInstruction) {
      this.waiting = () => value.keepWaiting;
    } else if (value instanceof Coroutine) {
      this.waiting = () => !value.isDone;
    } else if (typeof (value as PromiseLike<unknown>).then === 'function') {
      const pending: NonNullable<Coroutine['pending']> = { done: false };
      this.pending = pending;
      (value as PromiseLike<unknown>).then(
        (resolved) => Object.assign(pending, { done: true, value: resolved }),
        (error: unknown) => Object.assign(pending, { done: true, error, failed: true }),
      );
    } else if (typeof value === 'number') {
      this.stopped = true;
      throw new Error(`A coroutine yielded ${value}: write \`yield new WaitForSeconds(${value})\` — Unity's spelling, and it stops while Time.timeScale is 0.`);
    } else {
      this.stopped = true;
      throw new Error(
        'A coroutine yielded something it cannot wait for. Yield null (a frame), new WaitForSeconds(s), ' +
          'new WaitForSecondsRealtime(s), new WaitUntil(() => …), new WaitWhile(() => …), a Coroutine or a promise.',
      );
    }
  }
}
