/**
 * `@scenoco-three/audio` — sound for SceNoCo, spelled the way Unity spells it.
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <AudioMixer volume="0.8" />
 *   </Systems>
 *
 *   <PerspectiveCamera id="cam" position="z: 10" />
 *
 *   <Group position="x: 4">
 *     <Components>
 *       <AudioSource clip="../audio/engine.ogg" loop="true" spatial="true" minDistance="2" />
 *     </Components>
 *   </Group>
 * </Scene>
 * ```
 *
 * - `AudioSource` — the component that plays a clip. Unity's fields: `clip`, `playOnAwake`,
 *   `loop`, `volume`, `pitch`, `minDistance`, `maxDistance`; and `play`, `stop`, `pause`,
 *   `playOneShot`, `isPlaying`.
 * - `AudioClip` — a decoded sound file, referenced from a document by path like any other asset.
 * - `AudioMixer` — the scene's ears and master volume. Optional: the first source creates one.
 *
 * Core has no audio dependency, so an app that never imports this opens no `AudioContext`. Nor
 * does one that imports it and runs headless — there, every source is silent and every method is
 * a no-op, so a scene with sound in it still loads and still ticks in a test.
 */
export { AudioSource } from './AudioSource.js';
export { AudioMixer } from './AudioMixer.js';
export { AudioClip, sharedClip, hasWebAudio } from './AudioClip.js';
