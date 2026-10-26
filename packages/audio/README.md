# @scenoco-three/audio

Sound, spelled the way Unity spells it, on three.js's Web Audio wrappers. Part of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```ts
// sounds.ts
import engineUrl from './engine.ogg';
export const engine = sharedClip(engineUrl);   // and `await loadAssets(engine)` before play()
```

```tsx
<Group position={[4, 0, 0]}>
  <AudioSource clip={sounds.engine} loop spatial minDistance={2} />
</Group>
```

- `AudioSource` — `clip`, `playOnAwake`, `loop`, `volume`, `pitch`, `spatial`, `minDistance`,
  `maxDistance`; `play()`, `stop()`, `pause()`, `playOneShot()`, `isPlaying`. As in Unity, `volume`,
  `pitch` and `loop` change what is playing at once, and a source added in code plays straight away.
- `AudioClip` — a decoded file, one per URL through `sharedClip(url)`.
- `AudioMixer.volume` — the master volume. The listener follows whichever camera draws the scene,
  and the first click or key press starts the browser's audio.

Headless — a test, a server render — every source is silent and every call a no-op.
