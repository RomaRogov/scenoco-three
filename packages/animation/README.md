# @scenoco-three/animation

Animation for [SceNoCo](https://github.com/), two ways:

- **`<Tween>`** — a tiny **native tweener** (position/rotation/scale, easing, looping) + a
  reusable `Tween` class. Zero-dep, engine-driven (so `timeScale` applies). The AI-friendly
  alternative to animation tables for authored motion.
- **`<Animator>`** — plays a model's **premade glTF clips** (`THREE.AnimationMixer`), mirroring
  Unity's `Animator` (`play` / `crossFade` / `stop`).

```bash
npm i @scenoco-three/animation
```

```ts
import '@scenoco-three/animation'; // registers <Tween> + <Animator> (side effect)
```

```xml
<Mesh>
  <BoxGeometry /><MeshStandardMaterial />
  <Components>
    <Tween property="position" to="0 3 0" duration="1.5" easing="bounceOut" loop="pingpong" />
    <Tween property="rotation" to="0 6.283 0" duration="4" easing="linear" loop="loop" />
  </Components>
</Mesh>
```

## `<Tween>` — component

Tweens a node's transform **from its current value** to `to`.

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `property` | `position \| rotation \| scale` | `position` | Which transform to animate. |
| `to` | `vec3` | `0 0 0` | Target value. |
| `duration` | `float` | `1` | Seconds for one pass. |
| `easing` | enum | `quadInOut` | `linear`, `quad*`, `cubic*`, `sine*`, `expo*`, `backIn/Out`, `elasticOut`, `bounceOut`. |
| `loop` | `none \| loop \| pingpong` | `none` | Repeat mode. |
| `delay` | `float` | `0` | Delay before starting, seconds. |
| `playOnStart` | `bool` | `true` | Begin automatically. |

Control from code: `getComponent(TweenComponent)?.play()` / `.stop()`.

## Programmatic `Tween`

```ts
import { Tween } from '@scenoco-three/tween';

const t = new Tween([0, 0, 0], [0, 5, 0], (v) => mesh.position.set(v[0], v[1], v[2]), {
  duration: 1.5,
  easing: 'bounceOut',
  loop: 'pingpong',
  onComplete: () => console.log('done'),
});
// in a component's update(dt): t.update(dt);
```

Interpolates any numeric channel(s) `from → to` and applies each step via the callback. `EASINGS`
is the easing-function map; `Easing` / `TweenProperty` / `TweenLoop` are the registered enums.

## `<Animator>` — glTF clip player

Plays a model's **premade animation clips** through a `THREE.AnimationMixer`. Put it on the same
node as a [`<Model>`](../core) — the clips the model loaded are exposed on the clone and picked
up automatically.

```xml
<Group>
  <Model src="hero.glb" />
  <Components><Animator clip="Run" loop="true" speed="1" /></Components>
</Group>
```

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `clip` | `string` | `''` | Clip name to play on start (empty = first clip). |
| `loop` | `bool` | `true` | |
| `speed` | `float` | `1` | Playback speed (mixer `timeScale`). |
| `playOnStart` | `bool` | `true` | Play automatically (Unity `playAutomatically`). |

From code (Unity `Animator` API): `getComponent(Animator)?.play('Jump')` ·
`.crossFade('Run', 0.3)` · `.stop()`.

## Standalone & dependencies

Depends on `@scenoco-three/core`; `three` is a **peer**. It registers the `Tween` + `Animator`
components and uses only the public component API — core has no animation dependency. For the
compiler/Vite plugin to validate `<Tween>` / `<Animator>`, register the package
(`registerPackages`).

See the [repository](../../README.md).

## License

[MIT](./LICENSE)
