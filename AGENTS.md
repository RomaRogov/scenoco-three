# AGENTS.md — working on the SceNoCo repository

> Orientation for an AI agent **modifying this repository**. For the document format, run
> `npx scenoco describe`. For why a piece of the design is the way it is, read the doc comment
> above it — that is where it lives.

## What this is

**SceNoCo** (*Scene · Node · Component*) is a Unity-shaped scene and component layer for three.js
whose scenes live in XML documents. A TypeScript npm workspace monorepo.

```
   author edits scene.xml
        │
        ▼
   compiler:  parse → check against the workspace's own types → emit scene.gen.ts
        │            (components read with the TS checker; tags read from three's declarations)
        ▼
   the bundler treats scene.gen.ts as source; core runs the component lifecycle
```

## The rule everything follows

**Nothing is registered and nothing is looked up by name.** `class Spinner extends Component` *is*
the registration; `<Spinner speed="2">` is legal because that class has a `speed`; `<BoxGeometry
width="1">` is legal because three.js declares that parameter; an element is named by the type of
the field it fills. So a new component, tag, attribute or document kind is a **declaration** —
there is no table in the compiler to add it to, and adding one is a design mistake.

A package says what it contributes in its own `package.json` (`"scenoco"`): document kinds, file
kinds, previews, prose. See [MODULES.md](MODULES.md).

## Layering

`core` runs alone. `compiler` needs only `core`. `vite`, `observer` and `editor` are optional
consumers of `compiler`. Tag packages (`box2d`, `rapier`, `collision`, `ui`, `particles`, `audio`,
`postfx`) attach through core's public seams and **core knows nothing about them**. No upward
(`core`→`compiler`) and no sideways (`rapier`↔`box2d`) imports. Verify with the imports, not memory.

- `packages/core` — runtime: `Component`, `System`, `Effect`, `SceneManager`, `Engine`, the
  `Object3D`/`Scene` augmentations, input, coroutines, assets.
- `packages/compiler` — build time: parser, workspace scan, emitters, diagnostics, `scenoco` CLI.
- `packages/observer` — an MCP server that **observes** a running scene through headless Chrome.
- `packages/editor` — a standalone static site that edits documents. No play mode, no observer.

## What good looks like here

- **Derive, never tabulate.** A value's shape comes from its declared type. A name table is how
  this codebase used to be wrong.
- **Say it once.** Two copies of one rule are two rules that will disagree — including a preview
  and the runtime it previews.
- **A refusal is a message.** A diagnostic names `file:line:col` and the exact text to write
  instead. Silence is the worst outcome: a document that says something and a build that ignores it.
- **Comments carry the *why*.** The what is in the code. Keep them short and concrete.

## Build, check, test

```bash
npm install
npm run build        # every package in dependency order
npm run typecheck    # the root project, cross-package
npm test             # vitest — lean suite in zone folders under tests/
npm run examples:dev # the breakout example
```

Tests live in the root `tests/` in zone folders (`core/`, `compiler/`, `packages/`, `tooling/`);
one test per behaviour. A file outside `vitest.config.ts`'s include list does not run.

## Done means

Typecheck clean, tests green, `npm run build` passes, new behaviour has a test, and anything that
renders was seen **in a real browser**.
