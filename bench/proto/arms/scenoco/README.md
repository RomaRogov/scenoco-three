# scenoco

Built with [SceNoCo](https://github.com/RomaRogov/scenoco-three) — a Unity-shaped scene and
component layer for three.js, whose scenes are XML documents compiled to TypeScript.

```bash
npm install
npm run dev
```

## What is where

| | |
| --- | --- |
| `assets/scenes/main.scene.xml` | The scene. Start here. |
| `assets/geometry/` | Shared shapes, at Unity's sizes. A mesh names one. |
| `assets/materials/` | Shared materials, likewise. |
| `src/Spinner.ts` | A component. Its public fields are its XML attributes. |
| `src/tags.ts` | Which tag packages are in play. One import per package. |
| `src/main.ts` | Loads the scene and starts the loop. |

Each document compiles to a `.gen.ts` beside it on every build. Those are artifacts — they are
gitignored, and the XML is the source of truth.

## The two commands worth knowing

```bash
npx scenoco check
```

Compiles without writing, and reports `file:line:col` with the exact text to write instead. This
is also the CI command.

```bash
npx scenoco describe Mesh
```

What a name means in *this* project — a component's fields with their defaults, a tag's
attributes, or a document's ids. With no name, the whole vocabulary. Try
`npx scenoco describe main.scene.xml`, or `npx scenoco describe Cube` to see what it says about
shapes.

## Adding things

```bash
npx scenoco new scene level-2      # or: prefab, geometry, material, texture, render, particle
```

A component needs no scaffolding at all: write a class that extends `Component` in `src/`, give
it a public field, and it is available as an element with that attribute. That is the whole
registration.

Physics, in-canvas UI, particles, audio and post-processing are separate packages —
`@scenoco-three/box2d`, `rapier`, `ui`, `particles`, `audio`, `postfx`. Install one and its tags
join the vocabulary; install none and none of it ships.
