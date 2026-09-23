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

/**
 * Suspend until the next fixed step has run.
 *
 * Nothing to count: coroutines are polled *after* the step, so the first poll this wait ever
 * sees is already on the far side of one. Counting a frame here made every
 * `yield new WaitForFixedUpdate()` take two steps, which is a physics bug nobody would look for
 * in a coroutine.
 */
export class WaitForFixedUpdate extends YieldInstruction {
  override readonly fixed = true;

  keepWaiting(): boolean {
    return false;
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
  private settled: { value: unknown } | { error: unknown } | null = null;
  /** True while `body.next()` is on the stack — a generator cannot be re-entered. */
  private running = false;
  /** A stop asked for from inside the body, honoured the moment the body lets go. */
  private stopRequested = false;

  constructor(body: AnyGenerator) {
    this.body = body;
  }

  /**
   * @internal cancel, running any `finally` blocks in the generator.
   *
   * A coroutine that disables its own component, or destroys its own node, stops itself from
   * inside `next()` — and `return()` on a generator that is already running throws "Generator is
   * already running", which surfaced from `setActive(false)` with nothing in the message about
   * coroutines and left `onDisable` unrun. So a stop from inside is remembered and honoured by
   * the runner on the way out, which is where the generator is no longer on the stack.
   */
  stop(): void {
    if (this.done) return;
    if (this.running) {
      this.stopRequested = true;
      return;
    }
    this.done = true;
    this.body.return(undefined);
  }

  /**
   * @internal advance one step if the current wait is satisfied.
   * @param fixedPhase true when called from the fixed-step loop.
   */
  tick(fixedPhase: boolean): void {
    if (this.done) return;

    /** What to hand back into the generator: a promise's value, or nothing. */
    let resume: { value: unknown } | { error: unknown } = { value: undefined };

    if (this.waitingPromise) {
      // A promise resumes in the frame phase, like every other wait that is not a
      // `WaitForFixedUpdate` — the fixed phase runs a variable number of times per frame, and
      // resuming there made a coroutine's timing depend on the physics rate.
      if (fixedPhase || !this.settled) return;
      resume = this.settled;
      this.waitingPromise = null;
      this.settled = null;
    } else if (this.waiting) {
      // A wait is polled only in the phase it belongs to.
      if (this.waiting.fixed !== fixedPhase) return;
      if (this.waiting.keepWaiting()) return;
      this.waiting = null;
    } else if (fixedPhase) {
      // A coroutine that is not waiting on a fixed instruction advances in the update phase.
      return;
    }

    this.running = true;
    let result;
    try {
      // The awaited value goes back in, so `const data = yield fetch(url)` is the value and not
      // `undefined`; a rejection is thrown at the `yield`, where the body's own try/catch can
      // see it and where an unhandled one is reported like any other error in a coroutine.
      result = 'error' in resume ? this.body.throw(resume.error) : this.body.next(resume.value);
    } finally {
      this.running = false;
    }
    if (result.done || this.stopRequested) {
      this.done = true;
      if (!result.done) this.body.return(undefined);
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
      promise.then(
        (value) => {
          if (this.waitingPromise === promise) this.settled = { value };
        },
        (error: unknown) => {
          if (this.waitingPromise === promise) this.settled = { error };
        },
      );
    } else {
      // `yield null` / `yield` — resume next frame.
      this.waiting = null;
    }
  }
}
