import { AudioListener } from 'three';
import type { Object3D } from 'three';

/**
 * The engine's Web Audio "ears". Owns a single lazily-created `AudioListener` and
 * keeps it parented to whatever node hears the scene (the active camera), so
 * positional audio is heard from that pose. The `Engine` exposes it through the
 * lazy `engine.audioListener` getter, used by `@scenoco-three/audio`'s `Sound`.
 */
export class EngineAudio {
  private listener?: AudioListener;

  /**
   * The listener, created on first use and (re)parented to `host` — a scene with
   * no audio never opens an `AudioContext`. Returns `undefined` headless (no Web
   * Audio), so audio code stays a no-op in tests/SSR.
   */
  listenerOn(host: Object3D): AudioListener | undefined {
    if (typeof AudioContext === 'undefined') return undefined; // headless / no Web Audio
    if (!this.listener) this.listener = new AudioListener();
    if (this.listener.parent !== host) host.add(this.listener);
    return this.listener;
  }
}
