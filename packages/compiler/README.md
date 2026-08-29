# @scenoco-three/compiler

The build-time half of [SceNoCo](https://github.com/RomaRogov/scenoco-three): it turns scene
documents into **TypeScript modules beside them**, and it is the thing that checks your work.

```bash
npm i -D @scenoco-three/compiler
```

Most projects never call this directly — [`@scenoco-three/vite`](https://www.npmjs.com/package/@scenoco-three/vite)
runs it on build and on change. Reach for the CLI for one-off checks, for CI, and for scaffolding.

## What it does

A `*.scene.xml` compiles to a `*.scene.gen.ts` sitting next to it: a class whose `onLoad`
constructs the tree with ordinary three.js calls. **No XML, no parser and no registry ship to the
browser**, and because the output is typed code, `tsc` checks every cross-reference the document
made — a dangling `#id`, a missing asset, a wrong override target. Land in the output from a stack
trace and you can still read what the document said.

```xml
<!-- assets/scenes/level-1.scene.xml -->
<Scene camera="#camera" background="#05070d" render="../render/neon.render.xml">
  <PerspectiveCamera id="camera" position="y: 8.5; z: 24" />
  <Mesh geometry="../geometry/paddle.geometry.xml"
        material="../materials/paddle.material.xml" position="y: 1">
    <Components>
      <Paddle speed="16" halfRange="7.4" />
    </Components>
  </Mesh>
</Scene>
```

## The vocabulary is derived, not maintained

This is the design, and everything else follows from it.

- **A tag is a class; an attribute is one of that class's properties.** The tag vocabulary is
  scanned out of **three.js's own type declarations**, so `<BoxGeometry width>` exists because
  `BoxGeometry` has a `width`. Upgrading three adds attributes for free.
- **A component's authorable surface is its public fields.** The build finds your components by
  reading the workspace with the TypeScript API — extending `Component` is the whole registration.

There is one copy of the truth, so the document format cannot drift from the code.

## Diagnostics are the interface

Every rejection carries the text to write instead. This is the part to judge the project on.

```text
$ npx scenoco check

level-1.scene.xml:14:24   unknown-attribute  Brick has no "pints". Did you mean "points"?
level-1.scene.xml:19:12   unknown-attribute  Brick has no "strength". It takes: points, tint.
level-1.scene.xml:26:9    bad-value          position takes keyed axes. Write position="x: 1; y: 2; z: 3"
paddle.material.xml:4:15  bad-value          tint must be a hex colour. For tomato, write tint="#ff6347"

4 problems. No files written.
```

Note the second line: there is no near miss to suggest, so it names the whole vocabulary rather than
shrugging. Diagnostics are `file:line:col`, so an editor or a grep jumps straight to the character.

**One spelling per value** — keyed axes, `#rrggbb`, degrees. Where a second spelling is plausible
the compiler reads it and rejects it *with the answer*, so there is nothing to choose between while
authoring.

## CLI

```text
scenoco build [dir]     compile every document in the project
scenoco watch [dir]     compile, then recompile as documents and components change
scenoco check [dir]     compile without writing — for CI
scenoco new <kind> <name>
scenoco new geometry    the primitives: cube, sphere, cylinder, capsule, cone, quad, plane

Options
  --root <dir>            project root (default: the current directory)
  --tsconfig <file>       default: <root>/tsconfig.json
  --modules a,b           packages whose tags the documents may use, beyond three
```

`scenoco new geometry` with no name writes the whole primitive set at Unity's dimensions — a cube
one unit across, a sphere of radius 0.5 — so `scale` means what it means in an engine you already
know.

## Document kinds

| Extension | What it holds |
| --- | --- |
| `*.scene.xml` | The `<Scene>` root with its nodes and components |
| `*.prefab.xml` | A reusable node, spawned with `<Prefab src="…">` or `instantiate()` |
| `*.geometry.xml` | One three.js geometry, referenced by meshes |
| `*.material.xml` | One three.js material, referenced by meshes |
| `*.texture.xml` | An image plus its sampler settings |
| `*.render.xml` | How a scene is drawn: tone mapping, shadows, post effects |
| `*.particle.xml` | A particle effect, in Unity Shuriken module form |

Each compiles to a `.gen.ts` beside it — a build artifact, so gitignore `*.gen.ts`. The full format
reference, every value form and every diagnostic, is in
[`DSL.md`](https://github.com/RomaRogov/scenoco-three/blob/main/packages/compiler/DSL.md).

## Programmatic API

```ts
import { build, formatDiagnostics } from '@scenoco-three/compiler';

const result = await build({ root: process.cwd() });
if (result.diagnostics.length) console.error(formatDiagnostics(result.diagnostics));
```

`build()` is the whole compiler; the CLI and the Vite plugin are thin views over it. Also exported
for tools that need to *describe* a project rather than compile it: `scanProject`, `scanComponents`,
`scanTags`, `parseDocument`, `ASSET_KINDS`, `PLACEMENT`, and `formatDiagnostic`.

## License

[MIT](./LICENSE) · [Repository](https://github.com/RomaRogov/scenoco-three) ·
[Why it exists](https://github.com/RomaRogov/scenoco-three/blob/main/WHY.md)
