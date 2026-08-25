# SceNoCo

**Scene · Node · Component** — a Unity-shaped scene and component layer for
[Three.js](https://threejs.org), whose scenes are XML documents.

A document is **compiled at build time into a TypeScript module beside it**. So the browser gets
ordinary typed code — `tsc` checks every reference in it, a bad `#id` is a type error with a
real file and line, and no XML, parser or registry ships to the browser at all.

```xml
<!-- assets/scenes/level-1.scene.xml -->
<Scene camera="#camera" background="#05070d" render="../render/neon.render.xml">
  <Systems>
    <Physics2D gravity="x: 0; y: 0" />
  </Systems>

  <PerspectiveCamera id="camera" position="y: 8.5; z: 24">
    <Components>
      <CameraFit mode="contain" width="21" height="19.5" distance="24" />
    </Components>
  </PerspectiveCamera>

  <Mesh id="paddle" geometry="../geometry/paddle.geometry.xml"
        material="../materials/paddle.material.xml" position="y: 1">
    <Components>
      <Paddle speed="16" halfRange="7.4" />
      <RigidBody2D kind="kinematic" />
      <BoxCollider2D halfExtents="x: 1.6; y: 0.225" restitution="1" />
    </Components>
  </Mesh>

  <Prefab src="brick.prefab.xml" position="x: -2.55; y: 13.9">
    <Override target="#brick" hits="2" />
  </Prefab>
</Scene>
```

```ts
import { Component } from '@scenoco-three/core';

/** Moves the paddle. A public field is an attribute; extending Component is the registration. */
export class Paddle extends Component {
  speed = 16;
  halfRange = 7.4;

  override update(dt: number): void {
    this.object3D.position.x += this.speed * dt; // this.object3D IS a THREE.Object3D
  }
}
```

There is no decorator, no registry and nothing to import for a component to exist. The build
finds it by reading your workspace with the TypeScript checker, and its attributes *are* its
public fields — so the document format cannot drift from the code, because there is no second
copy of the truth anywhere.

## Why

- **Familiar by design.** Tags and attributes mirror three.js verbatim (`<BoxGeometry width>`,
  `<MeshStandardMaterial roughness>`), because the vocabulary is read from three's own
  declarations — a three.js upgrade that adds a parameter adds an attribute for free. The
  component API mirrors Unity (`getComponent`, `awake`/`start`/`update`, `enabled`, `destroy`,
  `dontDestroyOnLoad`). If you know three.js and a component engine, you know this.
- **The output is code you can read.** A scene compiles to a class whose `onLoad` constructs the
  tree — no bundle, no decoder, no reflection. Land in it from a stack trace and you can see
  what the XML said.
- **The compiler is the check.** `file:line:col` diagnostics with the exact text to write
  instead: a misspelt component names the nearest real one, `color="tomato"` answers with the
  hex, a positional vector answers with the keyed form. One pass reports everything.
- **One spelling per value.** Keyed axes, `#rrggbb`, degrees. Where a second spelling is
  plausible the compiler reads it and rejects it *with the answer*, so there is nothing to
  choose between while authoring.
- **Import no physics, ship no physics.** Physics, UI, particles, audio and post-processing are
  separate packages on public seams. Core is `three`-peer-only and knows about none of them.

## Packages

| Package | What it is |
| --- | --- |
| [`@scenoco-three/core`](packages/core) | Runtime: `Component`, `System`, `Effect`, `SceneManager`, `Engine`, the `Object3D`/`Scene` augmentations, input, coroutines, assets. |
| [`@scenoco-three/compiler`](packages/compiler) | Build time: the parser, the workspace scan, the emitters, diagnostics, the `scenoco` CLI and watcher. The format is documented in [`DSL.md`](packages/compiler/DSL.md). |
| [`@scenoco-three/vite`](packages/vite) | The Vite plugin: compile on start, recompile on change. ~160 lines. |
| [`@scenoco-three/editor`](packages/editor) | The local visual editor, and an observation-only MCP server. |
| [`@scenoco-three/box2d`](packages/box2d) | 2D physics (planck): `<Physics2D>`, `<RigidBody2D>`, `<*Collider2D>`, Unity-style contact hooks. |
| [`@scenoco-three/rapier`](packages/rapier) | 3D physics (Rapier), same shapes. |
| [`@scenoco-three/collision`](packages/collision) | Detection only, with rapier's exact tags — swap one import to switch. Zero deps. |
| [`@scenoco-three/ui`](packages/ui) | In-canvas UI on pmndrs uikit: `<Canvas>`, `<Panel>`, `<Text>`, `<Image>`, placed the way Unity's RectTransform places things. |
| [`@scenoco-three/particles`](packages/particles) | Unity-Shuriken-shaped `<ParticleSystem>` on three.quarks; effects are `.particle.xml` documents. |
| [`@scenoco-three/audio`](packages/audio) | `<AudioSource>`, 2D and positional. |
| [`@scenoco-three/postfx`](packages/postfx) | Render settings: `<ToneMapping>`, `<Shadows>`, `<Bloom>`, `<Vignette>` — the tags a `.render.xml` holds. |

## The document kinds

`*.scene.xml` · `*.prefab.xml` · `*.render.xml` · `*.particle.xml` · `*.material.xml` ·
`*.geometry.xml` · `*.texture.xml`. Each compiles to a `.gen.ts` beside it (a build artifact —
gitignore it). A prefab exports `XPrefab`, a scene exports `XScene`.

`scenoco new` lists the kinds this project can create and writes a starter that compiles.

## Quick start (this repo)

```bash
npm install
npm run examples:dev   # examples/breakout — three levels, Box2D, in-canvas HUD, bloom
npm test               # vitest — zone folders under tests/{core,compiler,packages,tooling}
npm run build          # every package, in dependency order
npm run typecheck      # cross-package tsc --noEmit
```

Working *on* this repo with an agent? Start at [`AGENTS.md`](AGENTS.md) (repo map) and
[`CONVENTIONS.md`](CONVENTIONS.md) (editing rules). The design reasoning is in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Documentation

- [`packages/compiler/DSL.md`](packages/compiler/DSL.md) — the document format: every value
  form, every block, every diagnostic.
- `packages/*/README.md` — each package documents its own surface.
- The API surface is documented where it lives: the doc comments in
  `packages/core/src/index.ts` are the tour.

## Status

Pre-1.0; the surface still moves. See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
