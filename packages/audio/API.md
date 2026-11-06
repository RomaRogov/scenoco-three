# API

Every public signature of `@scenoco-three/audio`. Read this instead of `src/`. Everything not here is
three.js's audio (`Audio`, `PositionalAudio`, `AudioListener`), as three.js documents it.

```ts
// ── clips: made once in a .ts module, named from scenes ─────────────────────────────────────
function sharedClip(url: string): AudioClip;   // one per URL: ten sources naming one file decode it once.
                                                // await loadAssets(clip) in main.ts before play()
class AudioClip extends Asset<AudioBuffer | null> {   // a decoded sound file — Unity's AudioClip
  readonly duration: number;   // seconds
}
function hasWebAudio(): boolean;   // whether this environment can play audio at all; under simulate and in Node, false

// ── a source: Unity's AudioSource, field for field ──────────────────────────────────────────
class AudioSource extends Behaviour {   // <AudioSource clip={sounds.engine} loop spatial minDistance={2} />
  clip: AudioClip;
  playOnAwake: boolean;        // true: plays as it starts; one added in code plays straight away
  loop: boolean;               // volume, pitch and loop change what is playing at once
  volume: number;              // 0..1, on top of AudioMixer.volume
  pitch: number;               // playback speed, and with it pitch
  spatial: boolean;            // false. true: 3D, quieter with distance from the listener
  minDistance: number;         // 3D: full volume within this distance (1)
  maxDistance: number;         // 3D: no quieter past this distance
  readonly isPlaying: boolean;
  readonly audio: Audio | PositionalAudio | null;   // three's live node, for anything not here
  play(): void;                // from the start
  stop(): void;                // and rewind
  pause(): void;               // play() resumes from here
  playOneShot(clip?: AudioClip, volumeScale?: number): void;   // a one-off over whatever is playing — Unity's PlayOneShot
}

// ── the ears ─────────────────────────────────────────────────────────────────────────────────
class AudioMixer {             // made by the first AudioSource that starts
  static volume: number;       // master volume, 0..1
  readonly listener: AudioListener | null;   // follows whichever camera draws the scene
}
// The browser starts audio on the first click or key press; until then sources wait, silent.
// Headless — a test, a server render — every source is silent and every call does nothing.
```
