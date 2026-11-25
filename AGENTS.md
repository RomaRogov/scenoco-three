# AGENTS.md — working on the SceNoCo repository

> Orientation for an AI agent **modifying this repository**. For using it in a game, read
> [`packages/core/API.md`](packages/core/API.md). For why a piece of the design is the way it is,
> read the doc comment above it — that is where it lives.

## What this is

**SceNoCo** (*Scene · Node · Component*) is Unity-style behaviours for three.js, with scenes written in
TSX and no React. A TypeScript npm workspace monorepo.

> A scene is a `.tsx` file that only declares. An element is `new Tag(...args)` of the class it
> imports; an attribute sets the property of that name the way R3F does, and takes what the
> constructor's options object takes for it. A child that is an
> `Object3D` is added, a `Behaviour` becomes a component, anything else is attached (`attach`).
> A prefab is `prefab(() => <Tsx />)`, a reference is `ref<T>()`, logic lives in behaviours. Everything else is
> three.js and Unity, as their own declarations describe them — `npm run check` reports any mistake
> at the line it was written on.

## The rule everything follows

**Nothing is registered and nothing is looked up by name.** `class Spinner extends Behaviour` *is*
the registration; `<Spinner speed={2} />` is legal because that class has a `speed`; `<BoxGeometry
args={[1, 2, 3]} />` is legal because three.js declares that constructor. `tsc` reads those
declarations — there is no table anywhere to add a tag, an attribute or a package to, and adding
one is a design mistake.

## Layering

The kernel runs alone and imports no renderer; `core` depends on it alone. Every other package depends
on `core` and on nothing else here; neither knows about them. No upward and no sideways imports
(`rapier`↔`box2d`). Verify with the imports, not memory.

- `@scenoco/kernel` — its own repository, [RomaRogov/scenoco-kernel](https://github.com/RomaRogov/scenoco-kernel),
  installed here from npm at the exact version core pins. Everything SceNoCo does, shared with every
  renderer (scenoco-pixi next): behaviours, the frame (`play`, `simulate`), scenes, prefabs and TSX, tweens,
  `Input`, `Random`, `QualitySettings`, `UIDocument`, the bridge and the editor's model side. It asks
  the renderer for the rest through one interface, `RendererPort` (`port.ts`), and learns its classes
  by declaration merging (`interface Renderer`, `kernel/renderer.ts`). `/internal` is what a renderer's
  package and editor reach it with. Its `README.md` is how to write a renderer package. A change to it
  is made and released there first, then core's pin is bumped here.
- `packages/core` — three.js's renderer package: `port.ts` implements and binds `RendererPort`,
  `renderer.ts` merges three.js's classes, `augment.ts` and `tween/shortcuts.ts` declare Unity's
  methods on them; then what is three.js's own — models, textures, `Animator`, freeing GPU
  resources, the editor's viewport, the Unity `snapshot`. Games import core, never the kernel.
- Packages (`rapier`, `box2d`, `particles`, `audio`, `postprocessing`, `splines`, `terrain`) attach through core's package seam: a private
  per-scene `System` reached with `service(node, Type)`, Unity's message names declared with
  `declareMessages`, and Unity's static facades (`Physics.gravity`) for anything a game sets.
- `packages/tools` — `scenoco check` (the scene rule) and `scene-edit.ts`, the editor's
  byte-preserving read/write of a scene file.
- `packages/create` — the starter `npm create @scenoco-three` copies; `template/AGENTS.md` is the
  rules card a model reads in a project, so a change to the API is a change there too.
- `packages/unity` — `scenoco-unity`: the game written into a Unity project. Core's `snapshot` (dev
  only) describes what the TSX declares; `convert.ts` mirrors it into Unity's space, `twin.ts` writes
  its prefabs and scenes as Scenoco's text (`.uprefab`, `.uscene`; `com.roro.scenoco` builds them),
  `page.ts` turns the page into UXML and USS, `input.ts` the named axes into input actions, `stub.ts`
  the code into C# stubs holding its TypeScript. The C# in `unity/` — the importer, which makes the
  assets the text names, and `PORTING.md` — is copied into the project; the port is checked with
  Diceload simulations (`com.roro.diceload`), and the export adds both packages to its manifest.
- `unity/com.scenoco.ymfm` — a Unity package, not an npm one: tetorica-fm2612's YM2612 (ymfm) and Sega PSG
  as a native plugin for macOS, iOS, Android and Windows, with tetorica's API in C#. For a game whose port
  plays them, added by hand; the exporter knows nothing of it. `Native~/build.sh` rebuilds it.
- `packages/editor` — the editor's interface: one self-contained module (React bundled in) the
  running game's page loads from a button in development. The live half is the kernel's `editor/`
  (selection, edits, pause, step, reset) over the renderer's viewport — core's `editor/`: the
  editor's camera, gizmo and picking; the file half is `scenoco()` in `packages/tools/src/vite.ts`,
  which also serves the module.

## Inside the kernel and core

Kernel paths are under `src/` of the kernel's repository (built, in `node_modules/@scenoco/kernel/dist`);
core's, marked, under `packages/core/src`.

| Where | What |
| --- | --- |
| `port.ts` | `RendererPort`: all the kernel asks of a renderer, and `bindRenderer`; core `port.ts` is three.js's |
| `kernel/renderer.ts` | `Renderer`, the merged interface a renderer names its classes in; `Node`, `RenderCamera` |
| `kernel/Behaviour.ts` | the base class: fields, hooks, lookups on its node, `listen`, coroutines |
| `kernel/registry.ts` | which behaviours are on which node, which runtime runs which root, every `getComponent*` and `findObject*` |
| `kernel/lifecycle.ts` | a behaviour's life — woken, live, started, destroyed at the end of the frame — and `service` |
| `kernel/attach.ts` `kernel/init.ts` | `addComponent`, and how a tag's attributes and refs land on a behaviour |
| `kernel/messages.ts` | `sendMessage`, `declareMessages`, the check that names a misspelled hook |
| `kernel/runtime.ts` | `Runtime`: one root's frame — start, fixed steps, update, coroutines, late update, destroy |
| `jsx.ts` | TSX to a renderer's objects, `prefab`, `ref`, attributes typed from properties and the constructor's options; `provenance.ts` records where each element was written |
| `play.ts` `simulate.ts` `scenes.ts` | a game run on the renderer's view, or stepped by a test; `SceneManager`, `instantiate` |
| `tween/` | `Tween`, a `System` of its own; `nodeTweens.ts` the `do…` methods (Unity's DOTween, which only the docs say) on a port's numbers; core `tween/shortcuts.ts` declares them on three's classes |
| `host.ts` | what the editor and the bridge do to a running game: hold its clock, draw from another camera |
| `bridge/` | `window.__scenoco`: `scope` (what `eval` can name), `input`, `read` (state as plain data), `drive` (`?drive=`) |
| `editor/` | the editor's live half: `host.ts` the `EditHost` the interface works through; core `editor/` the three.js viewport |
| core `snapshot.ts` | what the TSX declares, as plain data, for the Unity export (development only) |

Words of its own, each defined where it lives:
- **live** — receiving hooks: the node is under a running root and the behaviour is enabled;
  **wake** — make that true now, rather than at the next frame (`lifecycle.ts`).
- **dormant** — attached but not woken yet: `instantiate` and TSX wire a whole copy first (`attach.ts`).
- **reach** — how far a runtime lets behaviours go, `awake` to `frame`; the editor holds a scene short of `start` to show it as written (`lifecycle.ts`).
- **written** — the fields a tag set (`writtenOf`), so a component sizes itself from its node only where nothing was said (`attach.ts`).
- **given**, **own** — the attributes an element was written with, and a prefab root's own element apart from the tag that placed it (`provenance.ts`).
- **held** — a clock that moves only when stepped (`host.ts`).

## Inside the editor

`packages/editor/src`: the interface only. It reaches the game through the kernel's `EditHost` and the
files through the dev server, and keeps what it knows in a `Model` the interface reads.

| Where | What |
| --- | --- |
| `index.tsx` | `mount`: the panel beside the game, its parts wired; `page.ts` fits the page beside it, `keys.ts` the shortcuts |
| `model/Model.ts` | `Model`: the editor's state as the interface uses it — selection's view, changes, prefab mode, settings — over the parts below |
| `model/types.ts` | what the interface draws: `View`, `Tag`, `Attr` and their words |
| `model/values.ts` | a value as shown, as live and as written, and which values are editable (`kindOf`, `listItem`) |
| `model/view.ts` | `Reader`: a node as the TSX that made it, and where each attribute is written or why not |
| `model/history.ts` | `History`: every change — live at once, unsaved until Save, undone and redone |
| `model/server.ts` | `SceneFiles`: the dev server's answers about scene files — elements, types, links — and its writes |
| `model/structure.ts` `model/settings.ts` | Duplicate and Delete; what this browser keeps |
| `ui/` | React: `App` lays out `Toolbar`, `Tree`, `Inspector`; a tag is `Lines`, a value `fields` or, read-only, `Shown` |

Words of its own, each defined in `model/types.ts`:
- **written** — the file writes the attribute; **unsaved** — changed since the last Save.
- **live only** — a change the file does not take (spawned, made in code), and why; **locked** — shown,
  not edited: what a prefab is made of, outside prefab mode.
- **wide** — every copy of the prefab takes the change; **stage** — the prefab being edited, prefab mode.
- **prop**, **arg** — a prop of a function's tag (setting it calls the function again), one item of `args`.

## What good looks like here

- **Unity's names, three.js's objects.** An API reads as "works as in Unity" or it is three.js's
  own. A SceNoCo-only concept is a cost a model pays in lookups.
- **Derive, never tabulate.** A value's shape comes from its declared type.
- **Say it once.** Two copies of one rule are two rules that will disagree.
- **A refusal is a message.** An error names where and the exact text to write instead. Silence is
  the worst outcome: something written that is quietly ignored.
- **Comments carry the *why*.** The what is in the code. Keep them short and concrete.

## Build, check, test

```bash
npm install
npm run build        # every package in dependency order
npm run typecheck    # tsc over every package and the tests, then each example's and the starter's own check
npm test             # vitest — lean suite in zone folders under tests/
npm run examples:dev # the breakout example
npm run smoke:pack   # the packed tarballs, installed outside the workspace and played
npm run site         # the Pages site in site/: the README, the examples, llms.txt, the editor
npm run discovery    # context7.json again, after the root package.json's description or RULES in scripts/discovery.mjs changed
```

`context7.json`, `llms.txt` and the site's meta description take their words from the root
`package.json`'s `description` and the starter's rules card (`scripts/discovery.mjs`). The one
exception is Context7's rules, 255 characters each at most: a short restatement of the card in
`RULES` there, to keep in step when the card's directives change. Core ships the card's "How SceNoCo works" as its own `AGENTS.md`, written by its
`prepack` (`scripts/core-card.mjs`) — edit the starter's card, never that copy. The README is free to read as a letter.

Tests live in the root `tests/` in zone folders (`core/`, `packages/`, `tooling/`); one test per
behaviour. Test files run in parallel: one that writes files keeps them in its own
`.tmp/<name>-${process.pid}/` and removes only that. `tests/core/api.test.ts` fails when a game-facing export is missing from `API.md`.

A release is a tag: `git tag vX.Y.Z && git push origin vX.Y.Z` runs `.github/workflows/release.yml`,
which checks everything again and publishes every package at the version in its `package.json`. All
packages share one version; bump them together.

## Done means

Typecheck clean, tests green, `npm run build` passes, new behaviour has a test, and anything that
renders was seen **in a real browser**.
