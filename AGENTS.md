# AGENTS.md — working on the SceNoCo repository

> Orientation for an AI agent **modifying this repository**. For using it in a game, read
> [`packages/core/API.md`](packages/core/API.md). For why a piece of the design is the way it is,
> read the doc comment above it — that is where it lives.

## What this is

**SceNoCo** (*Scene · Node · Component*) is Unity's behaviours on three.js, with scenes written in
TSX and no React. A TypeScript npm workspace monorepo.

> A scene is a `.tsx` file that only declares. An element is `new Tag(...args)` of the class it
> imports; an attribute sets the property of that name the way R3F does. A child that is an
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

`core` runs alone. Every other package depends on `core` and on nothing else here; `core` knows
nothing about them. No upward and no sideways imports (`rapier`↔`box2d`). Verify with the imports,
not memory.

- `packages/core` — the kernel (`Behaviour`, the per-scene `Runtime`, coroutines, `Time`, events,
  destruction), the TSX runtime (`jsx.ts`), `play`, `SceneManager`, `Input`, assets, and the
  dev-only bridge a browser drives the game through (`observe.ts`).
- Packages (`rapier`, `box2d`, `particles`, `audio`, `splines`, `terrain`) attach through core's package seam: a private
  per-scene `System` reached with `service(node, Type)`, Unity's message names declared with
  `declareMessages`, and Unity's static facades (`Physics.gravity`) for anything a game sets.
- `packages/tools` — `scenoco check` (the scene rule) and `scene-edit.ts`, the editor's
  byte-preserving read/write of a scene file.
- `packages/create` — the starter `npm create @scenoco-three` copies; `template/AGENTS.md` is the
  rules card a model reads in a project, so a change to the API is a change there too.
- `packages/observer` — `observe(page)`: a test drives a running game through the bridge `play()`
  installs in development (`window.__scenoco`, core's `observe.ts`) on any Playwright page.
- `packages/unity` — `scenoco-unity`: the game's prefabs, scenes, meshes and materials written into a
  Unity project. Core's `snapshot` (dev only) describes what the TSX declares; the package mirrors it
  into Unity's space and a C# importer builds it with Unity's API.
- `packages/editor` — the editor's interface: one self-contained module (React bundled in) the
  running game's page loads from a button in development. The live half is core's `editor/` (pause,
  step, reset, the editor's camera and gizmo); the file half is `scenoco()` in `packages/tools/src/vite.ts`,
  which also serves the module.

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
npm run discovery    # context7.json again, after the root package.json's description or the rules card changed
```

`context7.json`, `llms.txt` and the site's meta description take their words from the root
`package.json`'s `description` and the starter's rules card (`scripts/discovery.mjs`); nothing there
is written a second time. Core ships the card's "How SceNoCo works" as its own `AGENTS.md`, written by its
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
