# @scenoco-three/core

Unity's component model on [Three.js](https://threejs.org). Layer 1 of
[SceNoCo](https://github.com/RomaRogov/scenoco-three): the only one you need, and the only one
with no build step — scenes here are ordinary TypeScript classes. The document format, the
compiler and the editor are separate packages that sit on top and never change what this one means.

Importing this module installs the augmentations: from here on **every `THREE.Object3D` can carry
components** and every `THREE.Scene` can load, unload and run an event cycle. There is no wrapper
type to learn and nothing to unwrap — a `Mesh` is still a `Mesh`, with the whole three.js API on it.

```bash
npm i @scenoco-three/core three
```

`three` is a peer dependency; core adds no others.

## The whole model, in four nouns

| | is | lives on | you write |
| --- | --- | --- | --- |
| **Component** | behaviour | one `Object3D` | `node.addComponent(Spinner, { speed: 2 })` |
| **System** | a scene-level service | the `Scene` | `scene.addSystem(Physics2D)` |
| **Prefab** | a node that builds itself | — | `parent.instantiate(Brick, { position })` |
| **Scene** | a `THREE.Scene` with a lifecycle | — | `SceneManager.load(Breakout)` |

```ts
import { Component, SceneManager } from '@scenoco-three/core';
import { Scene } from 'three';

class Spinner extends Component {
  speed = 1;                                     // a public field is a setting
  override update(dt: number) { this.object3D.rotation.y += this.speed * dt; }
}

class Level extends Scene {
  override onLoad() {
    this.createObject('cube').addComponent(Spinner, { speed: 2 });
  }
}

await SceneManager.load(Level);
```

**Extending `Component` is the entire registration.** No decorator, no registry, no manifest — and
because a component's public fields *are* its settings, there is never a second copy of that list to
fall out of sync.

## The rules

**Nothing is addressed by a string.** Components are found by class, scenes are loaded by class,
keys are named by `KeyCode`, events are typed `Event` fields. If you are about to write a string
literal that names a *thing*, there is a typed answer for it. Strings are for text a person reads.

**Components never declare a constructor.** `addComponent(Type, init)` constructs, then applies
`init`, then wakes — so a component always wakes up configured. Class field initializers run after
`super()`, which is why a constructor taking settings would have every one of them silently
overwritten by the subclass's own defaults.

**`awake` for your own state, `start` for reaching other components.** Nothing has been started
when `awake` runs, so a `start` that depends on another `start` is a bug.

**Every destroy is deferred** to the end of the frame — components, objects and systems alike.
Destroying inside a hook is therefore always safe, and every phase skips a doomed thing from the
moment it is marked.

**Authored data is in degrees.** `Object3D.eulerAngles` is the degrees view; radians exist only on
the live `THREE.Euler` underneath. It returns a copy, exactly as Unity's does — so
`node.eulerAngles.y = 90` is a no-op and `node.eulerAngles = new Vector3(0, 90, 0)` is the spelling
that works.

## The frame

`SceneManager.tick(timestamp)` runs the phases in this order. Systems run after every component in
the matching phase, which is the ordering physics needs.

```text
once, on the first frame: component.start → system.start
per fixed step:   component.fixedUpdate → system.fixedUpdate → coroutines
per frame:        component.update      → system.update       → coroutines
                  component.lateUpdate  → system.lateUpdate
                  deferred destruction
```

## What outlives a scene

`SceneManager.load` replaces everything — except what said otherwise.
`SceneManager.dontDestroyOnLoad(node)` moves a node into a persistent scene that is ticked and drawn
over the active one; `scene.dontDestroyOnLoad = true` exempts a whole scene, which is the shape that
cannot end up duplicated, since `loadAdditive` of a loaded scene is a no-op.
`SceneManager.findObjectOfType` searches every loaded scene, which is how a new level reaches what
survived the last one.

## What is in the box

`Component`, `System`, `SceneManager`, `SceneRuntime`, `Engine`, `Effect`/`RenderSettings`,
`Time`, `Input`/`KeyCode`/`MouseButton`, coroutines, `Animator`, `CameraFit`, `AttachTo`, the asset
helpers (`Asset`, `Model`, `sharedTexture`, `shared`), and the `Object3D`/`Scene` augmentations.

## What is deliberately absent

No engine object, no registry, no wire format, no reflection, no queries, no tags, no
`sendMessage`. Physics, UI, particles, audio and post-processing are **separate packages** — core is
`three`-peer-only and knows about none of them, so a project that never imports physics never ships
physics.

## Documents are optional

Core is usable on its own, in plain TypeScript, exactly as above. The rest of SceNoCo adds an
authoring layer: scene, prefab, geometry, material, texture, particle and render **documents** that
[`@scenoco-three/compiler`](https://www.npmjs.com/package/@scenoco-three/compiler) turns into
TypeScript which constructs these same objects — so the browser gets ordinary typed code, and `tsc`
checks every reference the document made.

## License

[MIT](./LICENSE) · [Repository](https://github.com/RomaRogov/scenoco-three) ·
[the repository](https://github.com/RomaRogov/scenoco-three)
