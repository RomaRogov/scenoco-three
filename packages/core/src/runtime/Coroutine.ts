import { Time } from './Time.js';

/**
 * Tolerance for the timed waits. Without it, accumulated float error leaves a wait of exactly
 * N frames sitting on a residue like 2.8e-17 and costs it an extra frame.
 */
const EPSILON = 1e-6;

/**
 * Base class for the objects a coroutine yields to suspend itself — Unity's `YieldInstruction`.
 * Subclass it for a wait the built-ins do not cover.
 *
 * `keepWaiting` is a method, where Unity has a property: the runtime polls it once per frame
 * and the timed waits count down on each poll, so a getter with a side effect would be a trap.
 */
export abstract class YieldInstruction {
  /** Return true while the coroutine should stay suspended. Polled once per frame. */
  abstract keepWaiting(): boolean;

  /** @internal set when this wait must be polled in the fixed-step phase instead. */
  readonly fixed: boolean = false;
}

/** Suspend for a number of seconds of scaled game time. */
export class WaitForSeconds extends YieldInstruction {
  protected remaining: number;

  constructor(seconds: number) {
    super();
    this.remaining = seconds;
  }

  /** The clock this wait counts down against. */
  protected delta(): number {
    return Time.deltaTime;
  }

  keepWaiting(): boolean {
    this.remaining -= this.delta();
    return this.remaining > EPSILON;
  }
}

/** Suspend for a number of seconds of real time, ignoring `Time.timeScale`. */
export class WaitForSecondsRealtime extends WaitForSeconds {
  protected override delta(): number {
    return Time.unscaledDeltaTime;
  }
}

/** Suspend until the next fixed step has run. */
export class WaitForFixedUpdate extends YieldInstruction {
  override readonly fixed = true;
  private ticked = false;

  keepWaiting(): boolean {
    if (this.ticked) return false;
    this.ticked = true;
    return true;
  }
}

/** Suspend until `predicate` returns true. */
export class WaitUntil extends YieldInstruction {
  private readonly predicate: () => boolean;

  constructor(predicate: () => boolean) {
    super();
    this.predicate = predicate;
  }

  keepWaiting(): boolean {
    return !this.predicate();
  }
}

/** Suspend while `predicate` returns true. */
export class WaitWhile extends YieldInstruction {
  private readonly predicate: () => boolean;

  constructor(predicate: () => boolean) {
    super();
    this.predicate = predicate;
  }

  keepWaiting(): boolean {
    return this.predicate();
  }
}

/**
 * Anything a coroutine may `yield`:
 *
 * - a {@link YieldInstruction} — `yield new WaitForSeconds(2)`
 * - `null` — resume next frame, as `yield return null` does in Unity
 * - a number — shorthand for `new WaitForSeconds(n)`
 * - a promise — resume once it settles
 */
export type Yieldable = YieldInstruction | null | undefined | number | Promise<unknown>;

/**
 * The return type of a coroutine method — an ordinary `Generator`, named after the
 * `IEnumerator` a Unity coroutine returns.
 */
export type IEnumerator = Generator<Yieldable, void, unknown>;

/** What `startCoroutine` accepts — any generator, whatever it happens to return. */
type AnyGenerator = Generator<Yieldable, unknown, unknown>;

/**
 * A running coroutine, as returned by `Component.startCoroutine`. Pass it to `stopCoroutine`
 * to cancel it early; it is otherwise opaque.
 */
export class Coroutine {
  /** True once the body has run to completion or the coroutine was stopped. */
  done = false;

  private readonly body: AnyGenerator;
  private waiting: YieldInstruction | null = null;
  private waitingPromise: Promise<unknown> | null = null;
  private promiseSettled = false;

  constructor(body: AnyGenerator) {
    this.body = body;
  }

  /** @internal cancel, running any `finally` blocks in the generator. */
  stop(): void {
    if (this.done) return;
    this.done = true;
    this.body.return(undefined);
  }

  /**
   * @internal advance one step if the current wait is satisfied.
   * @param fixedPhase true when called from the fixed-step loop.
   */
  tick(fixedPhase: boolean): void {
    if (this.done) return;

    if (this.waitingPromise) {
      if (!this.promiseSettled) return;
      this.waitingPromise = null;
      this.promiseSettled = false;
    } else if (this.waiting) {
      // A wait is polled only in the phase it belongs to.
      if (this.waiting.fixed !== fixedPhase) return;
      if (this.waiting.keepWaiting()) return;
      this.waiting = null;
    } else if (fixedPhase) {
      // A coroutine that is not waiting on a fixed instruction advances in the update phase.
      return;
    }

    const result = this.body.next();
    if (result.done) {
      this.done = true;
      return;
    }
    this.accept(result.value);
  }

  private accept(instruction: Yieldable): void {
    if (instruction instanceof YieldInstruction) {
      this.waiting = instruction;
    } else if (typeof instruction === 'number') {
      this.waiting = new WaitForSeconds(instruction);
    } else if (instruction && typeof (instruction as Promise<unknown>).then === 'function') {
      const promise = instruction as Promise<unknown>;
      this.waitingPromise = promise;
      const settle = () => {
        this.promiseSettled = true;
      };
      promise.then(settle, settle);
    } else {
      // `yield null` / `yield` — resume next frame.
      this.waiting = null;
    }
  }
}
