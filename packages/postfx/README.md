# @scenoco-three/postfx

How a frame is drawn — the tags a `*.render.xml` document is written from, for
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```bash
npm i @scenoco-three/postfx
```

```xml
<!-- assets/render/neon.render.xml -->
<Render>
  <Fog color="#05070d" near="20" far="46" />
  <ToneMapping curve="ACESFilmicToneMapping" exposure="1.05" />
  <Shadows />
  <Bloom strength="0.5" radius="0.45" threshold="0.5" />
</Render>
```

```xml
<Scene render="../render/neon.render.xml"> … </Scene>
```

## Tags

| Tag | What it does |
| --- | --- |
| `<ToneMapping>` | `curve` (default `ACESFilmicToneMapping`), `exposure` |
| `<Shadows>` | `enabled`, `type` (default `PCFSoftShadowMap`) |
| `<Bloom>` | `strength`, `radius`, `threshold` — how bright a pixel must be before it glows, where 1 is white |
| `<Vignette>` | `offset`, `darkness` |

`<Fog>` in the example is three.js's own class, not one of these: the render document takes any tag
the compiler can resolve, and three's vocabulary is read from its declarations.

Each tag is an `Effect` — a class whose public fields are its attributes, exactly like a
component's — which either configures the renderer or contributes a post-processing pass.

**An effect is on because the element is there.** There is no value meaning "off"; you delete the
line. Tuning a game's look is one file.

A scene that names no render document gets three.js's defaults, and **a project that never writes
one never loads the postprocessing addons.**

## License

[MIT](./LICENSE) · [Repository](https://github.com/RomaRogov/scenoco-three)
