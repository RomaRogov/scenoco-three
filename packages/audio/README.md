# @scenoco-three/audio

**Audio** for [SceNoCo](https://github.com/): a `Sound` component for 2D (global) and
**positional** 3D audio, built on core's lazy `engine.audioListener` and the `AssetCache`.
Import it for sound; don't, and no audio (or `AudioContext`) ships.

```bash
npm i @scenoco-three/audio
```

```ts
import '@scenoco-three/audio'; // registers the <Sound> component (side effect)
await engine.loadSceneAsync(bundle); // audio buffers preload before play
```

```xml
<Scene>
  <PerspectiveCamera position="0 0 10" />
  <Mesh><Sound src="music.mp3" loop="true" volume="0.6" /></Mesh>      <!-- 2D background music -->
  <Mesh position="-4 0 0">
    <SphereGeometry /><MeshStandardMaterial />
    <Sound src="engine.ogg" positional="true" loop="true" refDistance="2" />  <!-- 3D world sound -->
  </Mesh>
</Scene>
```

## `<Sound>` — component

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `src` | `string` (asset) | `''` | Audio file URL (mp3/ogg/wav/…), loaded via `AssetCache`. |
| `autoplay` | `bool` | `true` | Play as soon as the clip is loaded. |
| `loop` | `bool` | `false` | |
| `volume` | `float` | `1` | 0..1. |
| `positional` | `bool` | `false` | 3D audio that attenuates with distance from the camera. |
| `refDistance` | `float` | `1` | Reference distance for positional falloff. |

Control it from code via the component: `getComponent(Sound)?.play()` / `.stop()` /
`.setVolume(v)`.

## How it works

`src` is an **asset** (`asset: 'audio'`), so it's enumerated and preloaded like textures/models;
the decoded `AudioBuffer` is resolved from `engine.assets` (sync if preloaded, else streamed).
The "ears" are `engine.audioListener` — created **lazily** on the active camera, so a scene
with no `<Sound>` never opens an `AudioContext`. Positional sounds add a `THREE.PositionalAudio`
to their node; 2D sounds use `THREE.Audio`. Headless (no Web Audio) the component is inert.

## Standalone & dependencies

Depends on `@scenoco-three/core`; `three` is a **peer**. It registers one component and uses
only public core seams (`engine.audioListener`, `engine.assets`) — core has no audio
dependency, so importing this package is the only thing that adds audio to a build. For the
compiler/Vite plugin to validate `<Sound>`, register the package (`registerPackages`).

See the [repository](../../README.md).

## License

[MIT](./LICENSE)
