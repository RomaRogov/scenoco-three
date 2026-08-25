import { AudioLoader } from 'three';
import { Asset, shared } from '@scenoco-three/core';

/**
 * A decoded sound file — Unity's `AudioClip`, and referenced the same way: a field on an
 * `AudioSource`, filled in by the document.
 *
 * ```xml
 * <AudioSource clip="../audio/engine.ogg" loop="true" spatial="true" />
 * ```
 *
 * Decoding needs a Web Audio context, so the value is `null` where there is none — a test, a
 * server render. That is deliberate: a scene with sound in it still loads headless, and every
 * `AudioSource` in it is simply silent. A clip that fails to decode is reported and behaves the
 * same way, because a missing sound effect should not stop a level from loading.
 */
export class AudioClip extends Asset<AudioBuffer | null> {
  /** How long the clip runs, in seconds. `0` until it is loaded, or where there is no Web Audio. */
  get duration(): number {
    return this.isLoaded ? (this.value?.duration ?? 0) : 0;
  }

  protected override async fetch(): Promise<AudioBuffer | null> {
    if (!hasWebAudio()) return null;
    try {
      return await new AudioLoader().loadAsync(this.url);
    } catch (error) {
      console.error(`[scenoco] failed to load audio clip "${this.url}":`, error);
      return null;
    }
  }
}

/** The clip for a URL — one per URL, so ten sources naming one file decode it once. */
export function sharedClip(url: string): AudioClip {
  let clip = cache.get(url);
  if (!clip) {
    clip = shared(new AudioClip(url));
    cache.set(url, clip);
  }
  return clip;
}

const cache = new Map<string, AudioClip>();

/** @internal drop the URL cache. For tests and HMR. */
export function clearClipCache(): void {
  cache.clear();
}

/** Whether this environment can decode and play audio at all. */
export function hasWebAudio(): boolean {
  return typeof window !== 'undefined' && 'AudioContext' in window;
}
