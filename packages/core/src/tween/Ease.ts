// The curves are Robert Penner's easing equations, Copyright (c) 2001 Robert Penner, used under the
// MIT License: see the notice in this package's LICENSE.

/** Position through a tween, 0..1, to how far along its value is. Any such function is an ease. */
export type EaseFunction = (t: number) => number;

const TWO_PI = 2 * Math.PI;

function bounceOut(t: number): number {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t - 1.5 / 2.75) ** 2 + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t - 2.25 / 2.75) ** 2 + 0.9375;
  return 7.5625 * (t - 2.625 / 2.75) ** 2 + 0.984375;
}

function elasticIn(t: number): number {
  if (t <= 0 || t >= 1) return t;
  const u = t - 1;
  const period = 0.3;
  return -(2 ** (10 * u)) * Math.sin(((u - period / 4) * TWO_PI) / period);
}

/** Each family as it speeds up; easing out and in-out are the same curve turned round. */
const FAMILIES = {
  Sine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  Quad: (t: number) => t ** 2,
  Cubic: (t: number) => t ** 3,
  Quart: (t: number) => t ** 4,
  Quint: (t: number) => t ** 5,
  Expo: (t: number) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  Circ: (t: number) => 1 - Math.sqrt(1 - t * t),
  Elastic: elasticIn,
  Back: (t: number) => t * t * ((1.70158 + 1) * t - 1.70158),
  Bounce: (t: number) => 1 - bounceOut(1 - t),
} satisfies Record<string, EaseFunction>;

type Name = 'Linear' | `${'In' | 'Out' | 'InOut'}${keyof typeof FAMILIES}`;

const eases: Record<string, EaseFunction> = { Linear: (t) => t };
for (const [name, fn] of Object.entries(FAMILIES)) {
  eases[`In${name}`] = fn;
  eases[`Out${name}`] = (t) => 1 - fn(1 - t);
  eases[`InOut${name}`] = (t) => (t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 - 2 * t) / 2);
}

/** The curves a tween can follow: `setEase(Ease.OutBack)`. */
export const Ease = eases as Record<Name, EaseFunction>;
