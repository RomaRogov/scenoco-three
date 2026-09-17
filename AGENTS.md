# AGENTS.md — working on the SceNoCo repository

> Orientation for an AI agent (Claude Code, Aider, Cursor, …) **modifying this repository**.
> For the document format, run `npx scenoco describe`. For the reasoning behind a piece of the
> design, read the doc comment above it — that is where it lives.

## What this repo is

**SceNoCo** (*Scene · Node · Component*) is a Unity-shaped scene and component layer for
three.js whose scenes live in XML documents. A document is **compiled at build time into a
TypeScript module beside it** — so the browser gets ordinary typed code, `tsc` checks every
reference in it, and there is no runtime registry, no wire format and no parser shipped. It is a
TypeScript **npm workspace monorepo**.

## The one mental model

```
   author edits scene.xml
        │
        ▼
   compiler:  parse → check against the workspace's own types → emit scene.gen.ts
        │            (components read with the TS checker; tags read from three's declarations)
        ▼
   the bundler treats scene.gen.ts as source; core runs the component lifecycle
```

Nothing is registered and nothing is looked up by name: `class Spinner extends Component` *is*
the registration, `<Spinner speed="2">` is legal because that class has a `speed`, and
`<BoxGeometry width="1">` is legal because three.js declares that parameter.

## Package map & responsibilities

Layering is strict — a package may only import from those **below** it. Verify with the imports,
not memory.

| Package | Role | Imports (workspace) | Deps | Ships to browser? |
| --- | --- | --- | --- | --- |
| [`core`](packages/core) | Runtime: `Component`, `System`, `Effect`, `SceneManager`, `Engine`, the `Object3D`/`Scene` augmentations, `Input`, coroutines, assets. Ships three components (`CameraFit`, `Animator`, `AttachTo`) and one system (`Tweens`). | *(none)* | peer `three` | **yes** |
| [`compiler`](packages/compiler) | Build time: the XML parser, the workspace scan (TypeScript checker), the emitters, diagnostics, the `scenoco` CLI and the watcher. | `core` | `@xml-tools/parser`, `typescript` | no |
| [`vite`](packages/vite) | The Vite plugin: compile documents on `buildStart`, recompile on change. ~160 lines. | `compiler` | peer `vite` | no |
| [`observer`](packages/observer) | The MCP server (stdio by default). Compiles the project, serves a chrome-less page through its own Vite, launches Chrome headless with `playwright-core` and asks the page directly (`window.scenoco.call`) — no bridge, no WebSocket. Tools: `open`, `outline`, `screenshot`, `telemetry`, `play/pause/stop`, `simulate` (with `eval`). | `compiler` | `@modelcontextprotocol/sdk`, `playwright-core`, `zod`, peer `vite` | no |
| [`editor`](packages/editor) | The standalone visual editor: a static site (`build:app` → `dist-app/`) that opens a scene from a folder or a URL, parses it with `@scenoco-three/compiler/browser`, builds it live (`app/live/`), and saves back through the File System Access API. `scenoco-editor` serves the site. No play mode: it edits documents. **No run-time dependencies**; the observer and it share nothing. | *(build only)* | *(bundled)* | it *is* a site |
| [`box2d`](packages/box2d) | 2D physics: `<Physics2D>` + `<RigidBody2D>`/`<*Collider2D>` (planck), Unity-style contact hooks. | `core` | `planck` | yes, if imported |
| [`rapier`](packages/rapier) | 3D physics: the same shapes in 3D (Rapier). | `core` | `@dimforge/rapier3d-compat` | yes, if imported |
| [`collision`](packages/collision) | Detection only, with **rapier's exact tags** so a scene switches back-end by swapping one import. Zero deps. | `core` | peer `three` | yes, if imported |
| [`ui`](packages/ui) | In-canvas UI on pmndrs uikit: `<Canvas>`/`<Panel>`/`<Text>`/`<Image>` with Unity RectTransform-style placement. | `core` | `@pmndrs/uikit` | yes, if imported |
| [`particles`](packages/particles) | Unity-Shuriken-shaped `<ParticleSystem>` on three.quarks; effects are `*.particle.xml` documents. | `core` | `three.quarks` | yes, if imported |
| [`audio`](packages/audio) | `<AudioSource>` on three's audio, plus `sharedClip`. | `core` | peer `three` | yes, if imported |
| [`postfx`](packages/postfx) | Render settings: `<ToneMapping>`, `<Shadows>`, `<Bloom>`, `<Vignette>` — the tags a `*.render.xml` holds. | `core` | peer `three` | yes, if imported |

**Self-consistency invariant:** `core` runs alone. `compiler` needs only `core`. `vite`/`editor`
are optional consumers of `compiler`. Tag packages attach through core's public seams and **core
knows nothing about them**. No upward (`core`→`compiler`) or sideways (`rapier`↔`box2d`) imports.

## Where each kind of change goes

| To add / change… | Do this | Don't forget |
| --- | --- | --- |
| **A component** | A class extending `Component`, anywhere in the project. Public fields are its attributes. | Nothing else. No decorator, no registration, no barrel. |
| **A system** (a scene service) | A class extending `System`. Reached with `requireSystem`; components register themselves in `awake`. | It runs *after* every component in each phase. Read the scene in `start`, not `awake`. |
| **A render effect** | A class extending `Effect` in a tag package. `apply(ctx)` configures the frame; `createPass()` contributes a post-processing pass. | Concrete effects live in `postfx`, not core. |
| **A node tag** | Nothing — the vocabulary is three.js's exported classes, read from its declarations. | If a class is missing, it is filtered by `NOT_A_TAG` or by family in `scan/tags.ts`. |
| **A new document kind** | A `"scenoco"` block in the declaring package's `package.json`: an extension and the exported type whose declaration *is* the document. Nothing in the compiler. | The element names come from the **types**: a field holding a named type is that element, an array of one is it repeated. An inline object type has no name to be called by, and is refused. |
| **A component preview** | `"previews": { "<Component>": "./src/x.preview.js" }` in the declaring package's `package.json` — a project declares its own the same way. | One JS file, a pure `(props) => Object3D`, importing only `three`. The build refuses anything else; see [MODULES.md](MODULES.md). |
| **A DSL value shape** | `ValueShape` in `model.ts`, the reader in `scan/shape.ts`, the writer in `dsl/value.ts`. | The shape must be *derived* from the declared type, never from a name table. |
| **A diagnostic** | Wherever it is detected, with `file:line:col` and the text to write instead. | Give it a `file:line:col` and the exact text to write instead. |
| **Observer / MCP behaviour** | `packages/observer/src/` (server, browser, MCP, protocol) and `app/session.ts` (what the page can do: preview, telemetry, outline, simulate, eval). | The MCP surface **observes**; `eval` reaches the running scene only. |
| **Editor behaviour** | `packages/editor/app/` — the page, its chrome, `live/` (the builder, sources, edits), `session.ts`. | The editor has its own session; it does not import the observer. |

## The document kinds

`*.scene.xml` · `*.prefab.xml` · `*.render.xml` · `*.texture.xml` · `*.asset.xml`, plus whatever the
installed packages declare — `*.particle.xml` comes from `@scenoco-three/particles`. Each compiles
to a `.gen.ts` beside it (gitignored). A prefab exports `XPrefab`, a scene exports `XScene`; every
other kind exports one shared value.

## Build, check, test

```bash
npm install
npm run build        # every package in dependency order (tsc per package)
npm run typecheck    # the root project, cross-package
npm test             # vitest — lean suite in zone folders under tests/
npm run examples:dev # the breakout example
```

Tests live in the **root `tests/`** directory in zone folders (`core/`, `compiler/`,
`packages/`, `tooling/`) and run with the root vitest. A test file that is not in
`vitest.config.ts`'s include list does not run — check before assuming coverage.

## Definition of done (every change)

1. `npm run typecheck` is clean. 2. `npm test` is green. 3. `npm run build` passes. 4. New
behaviour has a test. 5. Anything that renders was checked **in a real browser**.

## Map of key files

- Runtime: `packages/core/src/runtime/{Component,System,SceneManager,SceneRuntime,Engine}.ts`
- The `Object3D` surface: `packages/core/src/runtime/augment/{object3d,components,prefabs,lifetime,scene}.ts`
- Compile pipeline: `packages/compiler/src/{build,assets}.ts`, `dsl/{parse,value,diagnostics}.ts`
- Emitters: `packages/compiler/src/emit/{graph,scope,nodes,spawn,wiring,scene,render,resource}.ts`
- The workspace scan: `packages/compiler/src/scan/{components,tags,shape,workspace}.ts`
- CLIs: `packages/compiler/src/cli.ts`, `packages/observer/src/cli/`, `packages/editor/src/cli/`
