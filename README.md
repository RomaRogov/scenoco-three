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
  <Mesh id="Turbine_01" position="0 1 0">
    <CylinderGeometry radiusTop="0.4" radiusBottom="0.4" height="2" />
    <MeshStandardMaterial color="#8888aa" roughness="0.3" metalness="0.8" />
    <Components>
      <Rotator speed="2" />
      <Oscillator id="turbine_osc" amplitude="0.5" frequency="0.5" />
    </Components>
  </Mesh>

  <Mesh id="Indicator" position="2.5 1 0">
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
  @property({ type: 'float', default: 1, description: 'Radians per second' })
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
  inline validation; a generated `component-api.md` (~1k tokens) is a compact authoring
  reference.
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
| [`@scenoco-three/rapier`](packages/rapier) | Optional **3D physics** add-on: `<Physics>` setting + `<RigidBody>`/`<Collider>` components (Rapier) on the public `System` seam. Import it, or ship no physics. |
| [`@scenoco-three/box2d`](packages/box2d) | Optional **2D physics** add-on: `<Physics2D>` setting + `<RigidBody2D>`/`<Collider2D>` components (planck/Box2D), with Unity-style `onCollisionEnter2D`/`onTriggerEnter2D` hooks. Same `System` seam; pure JS (no WASM). |

## Start a new project

```bash
scenoco init my-app   # scaffold a runnable project (starter component + scene + Vite wiring)
cd my-app && npm install
npm run dev           # http://localhost:5173
npm run validate      # "tsc for scenes"
npm run export        # generate schema/ (XSD + component-api.md)
```

The scaffold ships an `AGENTS.md` explaining the edit→validate→fix loop, so an agent can be
productive immediately. Custom components under `src/components/` are auto-discovered — the
validator, XSD, and docs pick them up with no registration.

## Quick start (this repo)

```bash
npm install
npm run dev          # playground at :5173 — two prefab instances + click-to-spawn
npm test             # 167 tests
npm run build:demo   # single-file demo/index.html (works over file://)
```

CLI (after `npm run build`):

```bash
node packages/compiler/dist/cli/index.js validate playground/scenes/turbine.scene.xml --components playground/components
node packages/compiler/dist/cli/index.js bundle   playground/scenes/turbine.prefab.xml -o turbine.bundle.json --components playground/components
node packages/compiler/dist/cli/index.js export   --out schema --components playground/components
```

## Documentation

Each package documents its own surface in `packages/*/README.md` (linked from the table
above). `npm run export` generates a compact scene-authoring reference
(`schema/component-api.md`) and an XSD (`schema/scene.xsd`) for IDE autocomplete, both
derived from the same component registry as the runtime.

## Status

**`0.1.0` — first frozen implementation.** A coherent baseline downstream projects can
depend on; pre-1.0, so the surface may still evolve.

Implemented: runtime + component lifecycle (incl. `fixedUpdate`/`lateUpdate` and a pluggable
`System` subsystem API), runtime `findObject`/`findComponent` and active scene cameras; an
**extensible node registry** — every Three.js `Object3D` is a tag, geometries/materials/
settings and nodes are one-file-per-type and projects register their own the same way
components do; typed component host nodes (`Component<PerspectiveCamera>`); the XML DSL with
validator, compiler + optimized bundles (v3, with `serializeScene` round-trip back to XML),
XSD/docs exporters, CLI (`init`/`validate`/`bundle`/`compile`/`decompile`/`export`/`watch`),
the Vite plugin with usage-based auto-import, material resource files, **prefabs** —
`<PrefabInstance>` (nestable) with scoped ids and overrides, `engine.instantiate()` for
dynamic spawning, and a **`prefab` property kind** (`@property({ type: 'prefab' })`) that
hands a component a spawnable `PrefabRef` from a build-time-embedded prefab — and **scene
settings** (`<Fog>`/`<FogExp2>`/`<Background>`); and **physics** as a separate package,
`@scenoco-three/rapier`, built on the public `System` seam. Next: the rest of the
scene-settings catalog.

## License

[MIT](LICENSE)
