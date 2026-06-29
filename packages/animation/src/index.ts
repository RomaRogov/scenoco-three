// `@scenoco-three/animation` — animation for SceNoCo:
//   • `<Tween>` — a declarative, zero-dep tweener (position/rotation/scale,
//     easing, looping) + a reusable `Tween` class, driven by the engine loop
//     (so `timeScale` applies). The AI-friendly alternative to animation tables.
//   • `<Animator>` — plays a model's premade glTF clips (THREE.AnimationMixer),
//     mirroring Unity's Animator (`play` / `crossFade` / `stop`).
//
// Importing this module registers both components + the easing/property/loop
// enums (decorator + enumOf side effects), hence `sideEffects`.
export { TweenComponent } from './TweenComponent.js';
export { Tween, type TweenOptions, type LoopMode } from './Tween.js';
export { EASINGS, Easing, TweenProperty, TweenLoop, type EasingName } from './easing.js';
export { Animator } from './Animator.js';

/** The tags this package registers — for the compiler/Vite `registerPackages`. */
export const sceneTags = ['Tween', 'Animator'] as const;
