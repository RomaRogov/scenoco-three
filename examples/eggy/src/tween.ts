import type { Yieldable } from '@scenoco-three/core';
import { Time } from '@scenoco-three/core';

/**
 * What the Unity game did with DOTween, as coroutines: `yield* tween(0.5, Ease.outBack, (t) => …)`
 * inside a behaviour's generator, started with `this.startCoroutine`. Game time, so a pause holds it.
 */
export type EaseFn = (t: number) => number;

/** DOTween's easings, by its names. */
export const Ease = {
  linear: (t: number) => t,
  inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  inCirc: (t: number) => 1 - Math.sqrt(1 - t * t),
  inExpo: (t: number) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inBack: (t: number) => 2.70158 * t * t * t - 1.70158 * t * t,
  outBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
} satisfies Record<string, EaseFn>;

/** Over `seconds`, after `delay`: `apply` gets the eased 0..1 each frame, and 1 at the end. */
export function* tween(seconds: number, ease: EaseFn, apply: (t: number) => void, delay = 0): Generator<Yieldable> {
  for (let waited = 0; waited < delay; waited += Time.deltaTime) yield null;
  for (let elapsed = 0; elapsed < seconds; elapsed += Time.deltaTime) {
    apply(ease(elapsed / seconds));
    yield null;
  }
  apply(1);
}

/** DOTween's punch: out by `amount` and back, wobbling `vibrato` times and dying away. 0 at both ends. */
export function punch(t: number, vibrato = 10): number {
  return Math.sin(t * Math.PI * vibrato * 0.5) * (1 - t);
}

/** DOTween's jump: a hop of `power` metres over a straight path, 0 at both ends. */
export function hop(t: number, power: number): number {
  return power * 4 * t * (1 - t);
}
