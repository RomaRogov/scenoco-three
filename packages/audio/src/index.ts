// `@scenoco-three/audio` — audio for SceNoCo: a `Sound` component (2D + positional)
// built on core's lazy `engine.audioListener` and the `AssetCache` (an `audio`
// asset kind + `AudioLoader`). Core has no audio dependency; an app that doesn't
// import this package opens no `AudioContext`.
//
// Importing this module registers the `Sound` component (decorator side effect),
// which is why the package is marked `sideEffects`.
export { Sound } from './Sound.js';

/**
 * The tags this package registers — read by the compiler/Vite plugin
 * (`registerPackages`) so a scene that uses `<Sound>` validates and imports the
 * package. The convention for any SceNoCo tag package.
 */
export const sceneTags = ['Sound'] as const;
