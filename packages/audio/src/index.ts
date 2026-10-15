/**
 * `@scenoco-three/audio` — sound, spelled the way Unity spells it.
 *
 * ```ts
 * // sounds.ts
 * import engineUrl from './engine.ogg';
 * export const engine = sharedClip(engineUrl);
 * ```
 * ```tsx
 * <Group position={[4, 0, 0]}>
 *   <AudioSource clip={sounds.engine} loop spatial minDistance={2} />
 * </Group>
 * ```
 *
 * - `AudioSource` — plays a clip. Unity's fields: `clip`, `playOnAwake`, `loop`, `volume`, `pitch`,
 *   `minDistance`, `maxDistance`; and `play`, `stop`, `pause`, `playOneShot`, `isPlaying`.
 * - `AudioClip` — a decoded sound file, from `sharedClip(url)`; `await loadAssets(clip)` before
 *   the scene that plays it.
 * - `AudioMixer.volume` — the master volume. The listener follows the camera on its own.
 *
 * Headless — a test, a server render — every source is silent and every method a no-op, so a
 * scene with sound in it still runs.
 */
export { AudioSource } from './AudioSource.js';
export { AudioMixer } from './AudioMixer.js';
export { AudioClip, sharedClip, hasWebAudio } from './AudioClip.js';
