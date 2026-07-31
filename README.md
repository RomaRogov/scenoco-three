# SceNoCo

**Scene · Node · Component** — a component-based scene framework for [Three.js](https://threejs.org).

Scenes are plain XML files with a strict, validated schema. Behaviour is Unity/Cocos-style
components written in TypeScript. At build time, scenes compile into compact binary-friendly
bundles — **the browser runtime contains no XML and no parser**.

The design rests on one idea: **the scene is a file, and the toolchain is a single source
of truth.** Component classes declare their XML surface with decorators; the validator,
compiler, and XSD/docs exporters are all generated views of the same registry, so the
schema can never drift from the runtime. A side benefit of that discipline — files plus a
validator with line-numbered, fix-it diagnostics — is that the standard edit → check → fix
loop works on scenes, which makes the framework an excellent target for tooling and agents.
But you don't need any of that: it's a component scene framework for Three.js, usable as one.

```xml
<Scene>
  <Mesh id="Turbine_01" position="y: 1">
    <CylinderGeometry radiusTop="0.4" radiusBottom="0.4" height="2" />
    <MeshStandardMaterial color="#8888aa" roughness="0.3" metalness="0.8" />
    <Components>
      <Rotator speed="2" />
      <Oscillator id="turbine_osc" amplitude="0.5" frequency="0.5" />
    </Components>
  </Mesh>

  <Mesh id="Indicator" position="x: 2.5; y: 1">
    <SphereGeometry radius="0.3" />
    <Components>
      <Follow source="#turbine_osc" scale="2" />   <!-- typed component reference -->
      <LookAt target="#Turbine_01" />              <!-- node reference -->
    </Components>
  </Mesh>
</Scene>
```

```ts
import { Component, component, property } from '@scenoco-three/core';

@component({ name: 'Rotator', description: 'Rotates the host node around its Y axis' })
export class Rotator extends Component {
  @property({ type: 'float', description: 'Radians per second' })
  speed = 1;

  override update(dt: number): void {
    this.node.rotation.y += this.speed * dt; // this.node IS a THREE.Object3D
  }
}
```

That's the whole job: the validator, compiler, XSD, docs — and the scene bundles — pick the
component up automatically. No registration wiring.

## Why

- **Familiar by design.** Tags and attributes mirror Three.js verbatim (`<BoxGeometry width>`,
  `<MeshStandardMaterial roughness>`); the component API mirrors Unity/Cocos
  (`getComponent`, `onLoad`/`start`/`update`, `enabled`, `destroy`). If you know Three.js
  and a component engine, you already know the conventions.
- **Scenes are files; the validator is the toolchain.** `scenoco validate` is "tsc for
  scenes": `file:line:col` diagnostics with did-you-mean suggestions, all generated from the
  same registry as the runtime. A generated XSD gives any XML-aware IDE autocomplete and
  inline validation; a generated `scene-api.json` is a compact, machine-readable description
  of every tag/component (with the now-mandatory descriptions) for editor tooling and agents/RAG.
- **Optimized runtime, Cocos-style.** XML compiles to a flat, indexed bundle: interned
  string pool, default-value elision via bitmasks, special-cased transforms,
  integer-encoded references. ~73% smaller than the naive compiled JSON — and the XML
  parser/validator never ship to the browser.
- **Usage-based shipping (tree-shakeable).** A scene bundle imports exactly the modules it
  uses — components *and* node tags. The runtime entry registers nothing on its own, so a
  scene of `<Mesh><BoxGeometry/></Mesh>` ships those two node modules, not the whole palette;
  unused tags (and their three classes) never reach the bundle. Physics lives in a separate
  package on a public `System` seam — import no physics, ship no physics.

## Packages

| Package | What it is |
| --- | --- |
| [`@scenoco-three/core`](packages/core) | Runtime: `Engine`, `Component`, decorators, registry, bundle deserializer, Three.js node factories. No XML anywhere. |
| [`@scenoco-three/compiler`](packages/compiler) | Build-time: XML parser, validator, scene compiler, bundler, XSD/docs exporters, component discovery, file watcher, and the `scenoco` CLI. |
| [`@scenoco-three/vite`](packages/vite) | Vite plugin: `import scene from './x.scene.xml?bundle'` — compiles in Node, ships the bundle + the components the scene uses. |
| [`@scenoco-three/editor`](packages/editor) | Local visual editor + **MCP server** (`open_file` / `get_preview` / `playback` / `simulate` / `get_telemetry`) driving the one live browser tab — the "eyes and hands" for a multimodal agent. Build-time only. |
| [`@scenoco-three/rapier`](packages/rapier) | Optional **3D physics** add-on: `<Physics>` setting + `<RigidBody>`/`<Collider>` components (Rapier) on the public `System` seam. Import it, or ship no physics. |
| [`@scenoco-three/box2d`](packages/box2d) | Optional **2D physics** add-on: `<Physics2D>` setting + `<RigidBody2D>`/`<Collider2D>` components (planck/Box2D), with Unity-style `onCollisionEnter2D`/`onTriggerEnter2D` hooks. Same `System` seam; pure JS (no WASM). |
| [`@scenoco-three/collision`](packages/collision) | Optional **detection-only collision** add-on: the *same tags and hooks as rapier* (`<RigidBody>`/`<*Collider>`, `onCollisionEnter`/`onTriggerEnter`) with inert dynamics — overlap events without a physics solver; switch to real physics by swapping one import. Zero deps. |
| [`@scenoco-three/audio`](packages/audio) | Optional **audio** add-on: a `<Sound>` component (2D + positional 3D) on core's lazy `AudioListener` + the `AssetCache`. Import it, or open no `AudioContext`. |
| [`@scenoco-three/animation`](packages/animation) | Optional **animation** add-on: a declarative `<Tween>` (easing/looping, zero-dep) + an `<Animator>` that plays a model's premade glTF clips (Unity `Animator` API). |
| [`@scenoco-three/particles`](packages/particles) | Optional **particles/VFX** add-on: a Unity-Shuriken-style `<ParticleSystem>` rendered by [three.quarks](https://github.com/Alchemist0823/three.quarks) (batched) — inline props for quick effects, or `src="fire.particle.xml"` for a full definition with its own grammar + XSD. |

## Start a new project

```bash
scenoco init my-app   # scaffold a runnable project (starter component + scene + Vite wiring)
cd my-app && npm install
npm run dev           # http://localhost:5173
npm run validate      # "tsc for scenes"
npm run export        # generate schema/ (XSD + scene-api.json)
```

The scaffold ships an `AGENTS.md` explaining the edit→validate→fix loop, so an agent can be
productive immediately. The project convention is **zero-config**: components and scenes live
under `assets/` (auto-discovered — the validator, XSD, and docs pick them up with no
registration), and any `@scenoco-three/*` tag package in your `package.json` (physics, audio,
particles, …) is registered automatically by the CLI, the Vite plugin, and the editor.

## Quick start (this repo)

```bash
npm install
npm run examples:dev    # examples/breakout at :5173 (Box2D physics, DOM HUD, particles)
npm test                # vitest — zone folders under tests/{core,compiler,tooling,packages,editor}
npm run smoke:build     # real singlefile `vite build`; asserts prod-only runtime plumbing survives
npm run build           # build every package in dependency order
npm run typecheck       # cross-package tsc --noEmit
```

> **Before tagging a release, run `npm run smoke:build`** (or a real `vite build` on each example
> and open the output). Dev (`vite`) and the editor don't tree-shake or bundle the way a
> production build does, so a class of bug — a side-effect module dropped by tree-shaking, a
> module-evaluation-order hazard — is invisible until a real `vite build`. `smoke:build` guards
> that gap automatically; it's cheap enough to run in CI.

Working *on* this repo with an agent? Start at [`AGENTS.md`](AGENTS.md) (repo map) and
[`CONVENTIONS.md`](CONVENTIONS.md) (editing rules).

CLI (after `npm run build`; run from a project root — components in `assets/` and tag
packages in `package.json` are picked up with no flags):

```bash
cd examples/breakout
node ../../packages/compiler/dist/cli/index.js validate assets/scenes/breakout.scene.xml
node ../../packages/compiler/dist/cli/index.js bundle   assets/scenes/brick.prefab.xml -o brick.bundle.json
node ../../packages/compiler/dist/cli/index.js export   --out schema
```

## Documentation

Each package documents its own surface in `packages/*/README.md` (linked from the table
above). `npm run export`, run inside a project (e.g. `examples/breakout`), generates a
machine-readable scene-language reference (`schema/scene-api.json`) and XSDs for every document kind (`scene.xsd`, `prefab.xsd`,
`material.xsd`, plus any tag package's own — e.g. particles' `particle.xsd`) for IDE
autocomplete, all derived from the same component registry as the runtime.

## Status

**`0.3.0`** — a hardening release driven by shipping real games on the framework; pre-1.0, so
the surface may still evolve. See [CHANGELOG.md](CHANGELOG.md) for the full list.

On top of the 0.2.0 feature set (asset pipeline, custom shaders, pointer events + touch input,
multi-camera, execution order, deterministic RNG, physics joints + collision hooks, audio and
animation add-ons), 0.3.0 adds: a **zero-config project convention** (components/scenes under
`assets/`; tag packages auto-registered from `package.json` by the CLI, Vite plugin, and
editor); two new add-on packages — **`@scenoco-three/collision`** (detection-only, rapier's
exact API) and **`@scenoco-three/particles`** (three.quarks VFX with a validated
`.particle.xml` format); **in-canvas UI** (**`@scenoco-three/ui`**: flexbox
`<Fullscreen>`/`<Container>`/`<Text>`/`<Image>` scene tags rendered by pmndrs uikit,
attributes = uikit properties verbatim); the **`src=` sub-document
seam** (`registerSrcCompiler` + `Component.applyConfig`, letting a package own its own
validated file format); runtime `@system` attachment for spawn-only scenes; Unity-shaped
`PrefabRef.spawn` placement and type-only component queries; `scenoco export` publishing
**all four document XSDs**; and an editor that **survives broken component code** (last-good
registry, error banner, auto-reload) with a start-up file picker and a pinned MCP port. Now
**10 packages**.

## License

[MIT](LICENSE)
