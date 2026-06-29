# @scenoco-three/core

The **runtime** of [SceNoCo](https://github.com/) — a component-based scene framework for
[Three.js](https://threejs.org). *Scene · Node · Component*, Unity/Cocos-shaped, with the
scene compiled to a compact bundle the runtime loads. **No XML parser or validator ships
here** — that lives in `@scenoco-three/compiler` (build time only).

```bash
npm i @scenoco-three/core three
```

- [Quick start](#quick-start)
- [Concepts](#concepts)
- [API reference](#api-reference) — [`Engine`](#engine) · [`Component`](#component) ·
  [`System`](#system) · [`InputManager`](#inputmanager) · [decorators](#decorators) ·
  [`enumOf`](#enumof) · [registry](#registry) · [`PrefabRef`](#prefabref) · [bundle](#bundle)
- [Standalone & dependencies](#standalone--dependencies)

## Quick start

```ts
import { Engine, Component, component, property } from '@scenoco-three/core';
import sceneBundle from './scene.bundle.json'; // produced at build time by the compiler

@component({ name: 'Rotator', description: 'Spins the host around Y' })
export class Rotator extends Component {
  @property({ type: 'float', default: 1, description: 'Radians/sec' }) speed = 1;
  override update(dt: number) { this.node.rotation.y += this.speed * dt; }
}

const engine = new Engine({ canvas: document.querySelector('canvas')! });
engine.loadScene(sceneBundle); // instantiates the Three.js scene + wires components
```

Headless (tests, servers) — omit the canvas and drive the loop by hand:

```ts
const engine = new Engine();        // no renderer
engine.loadScene(sceneBundle);
engine.tick(1 / 60);                // advance one frame
const ball = engine.findObject('ball'); // THREE.Object3D | undefined
engine.dispose();
```

### Or build the scene by hand — no compiler, no bundle

You don't need a compiled scene to use components. `engine.scene` is a real `THREE.Scene`
from construction, so you can populate it with plain Three.js objects and attach components
imperatively — Unity's `AddComponent`. The component gets the full lifecycle (`onLoad`/
`onEnable` run immediately, `start`/`update`/… on `tick`) exactly as if it had been loaded
from a bundle:

```ts
import * as THREE from 'three';
import { Engine } from '@scenoco-three/core';
import { Rotator } from './Rotator';

const engine = new Engine({ canvas: document.querySelector('canvas')! });

const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
engine.scene.add(cube);                            // plain Three.js — no wrapper
const rotator = engine.addComponent(cube, Rotator, { speed: 2 }); // attach + run onLoad now
//        engine.addComponent(cube, 'Rotator', { speed: 2 })       // …or by registered name

engine.scene.add(new THREE.DirectionalLight(0xffffff, 2).translateZ(3));
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.z = 5;
engine.scene.add(camera);
engine.mainCamera = camera;                        // the loop draws through this

engine.start();                                    // rAF loop (or engine.tick(dt) by hand)

// Later — manipulate components on any object at runtime:
engine.getComponents(cube);          // readonly Component[] on this node
rotator.enabled = false;             // runs onDisable
engine.removeComponent(rotator);     // runs onDisable + onDestroy
```

Bundles and hand-built objects coexist: you can `engine.loadScene(bundle)` and still
`engine.addComponent(...)` onto objects you add yourself, or skip bundles entirely. The
compiler/XML is one way to *produce* a scene; the runtime only cares about `THREE.Object3D`s
and the components attached to them.

## Concepts

| Concept | What it is |
| --- | --- |
| **Node** | A `THREE.Object3D` — used directly, **no wrapper**. `this.node.rotation.y += dt` just works. |
| **Component** | Behaviour attached to a node (Unity `MonoBehaviour` / Cocos `cc.Component`). |
| **Attachment** | Leaf config on a node: geometry, material, or a `<Scene>` setting (fog/background). |
| **System** | A batch processor for all components of one type (physics, etc.), on a public seam. |
| **Bundle** | The compiled, indexed scene the runtime loads. The runtime never sees XML. |
| **Prefab** | A reusable subtree spawned at runtime via `engine.instantiate()` or a `PrefabRef`. |

The registry decorators (`@component`/`@node`/`@attachment`/`@system`/`@property`) are the
single source of truth — the compiler, validator, and exporters are generated views of the
same metadata, so the schema can never drift from the code.

---

## API reference

### `Engine`

```ts
new Engine(options?: EngineOptions)
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `canvas` | `HTMLCanvasElement` | — | Render target. Omit for headless. |
| `autoStart` | `boolean` | `true` | Start the rAF loop when a canvas is given. |
| `fixedTimeStep` | `number` | `1/60` | Seconds per fixed step (`fixedUpdate`, physics). |
| `editor` | `boolean` | `false` | Editor mode: instantiate but run no hooks except `@executeInEditor`. |
| `preserveDrawingBuffer` | `boolean` | `false` | Keep the buffer so `canvas.toDataURL()` can capture a frame. |

**Properties:** `scene: THREE.Scene` · `renderer?: WebGLRenderer` · `mainCamera?: Camera`
(first camera found in the scene; the loop draws through it) · `input: InputManager` ·
`editorMode: boolean`.

**Scene lifecycle**

```ts
engine.loadScene(bundleOrCompiledScene): void          // synchronous full swap; wires all refs before any onLoad
await engine.loadSceneAsync(bundleOrCompiledScene)     // awaits preload providers (assets) first, then instantiates
engine.disposeScene(): void                            // unload, free GPU resources, leave an empty scene
engine.dispose(): void                                 // stop loop + destroy everything
```

**Async assets** — register a `PreloadProvider` (an asset package does this) and the engine
awaits it before `onLoad`, so components never see missing assets:

```ts
engine.addPreloadProvider(async (compiled) => { /* load this scene's assets into a cache */ });
await engine.loadSceneAsync(bundle);          // assets ready before any onLoad runs
const root = await engine.instantiateAsync(prefabBundle); // same guarantee for runtime spawns
```

`loadScene` stays synchronous (and asset-agnostic — assets stream in afterward); reach for the
`*Async` variants only when a component's `onLoad` must see its assets already loaded.

**Components**

```ts
engine.addComponent(node, Rotator, { speed: 2 })  // by class (typed) …
engine.addComponent(node, 'Rotator', { speed: 2 }) // … or by registered name
engine.removeComponent(instance)
engine.getComponents(node): readonly Component[]
engine.findComponent<T>(id, type?): T | undefined  // type may be a class or a name string
engine.findObject(id): Object3D | undefined        // by scene id — indexed (O(1)), with a traversal fallback
```

**Execution order** (Unity Script Execution Order): `@component({ order })` runs components in
ascending `order` across every phase (`onLoad`/`start`/`update`/`fixedUpdate`/`lateUpdate`);
equal orders keep instantiation order. Default 0.

**Loop (headless or manual)**

```ts
engine.tick(dt)   // fixedUpdate ×N → start/update → lateUpdate → systems → render
engine.start()    // begin the requestAnimationFrame loop (needs a canvas)
engine.stop()
```

**Systems & attachments**

```ts
engine.addSystem(new PhysicsSystem())
engine.getSystem(PhysicsSystem): T | undefined
engine.findAttachment(Physics)?.gravity        // live singleton config attachment
```

**Prefabs / dynamic spawning**

```ts
const root = engine.instantiate(prefabBundle, parent?)  // Unity Instantiate; returns the root
engine.destroy(root)                                    // remove a subtree + its components
```

**Time & timeScale**

```ts
engine.timeScale = 0.5   // slow-mo; 0 pauses gameplay (update still runs, deltaTime = 0)
engine.time              // scaled seconds elapsed   · engine.deltaTime  — scaled dt this frame
engine.unscaledTime      // wall-clock seconds       · engine.frameCount — frames ticked
engine.interpolationAlpha // [0,1) blend into the next fixed step (physics reads it to de-jitter)
```

**Deterministic RNG** (seed via `new Engine({ seed })`) — reproducible runs/replays/QA. Use it
instead of `Math.random()`:

```ts
engine.random()            // [0, 1)
engine.randomRange(2, 5)   // [2, 5)
engine.randomInt(0, 6)     // 0..5
engine.reseed(42); engine.seed
```

**Cameras** — `engine.cameras` is every scene camera sorted by `priority` (Unity camera depth);
the render loop draws them **in order, one after another** — the first paints the background,
later ones overlay (depth-cleared) for UI/HUD passes. `mainCamera` (the first camera found, or
set it yourself) is the one used for raycasting/pointer. Set priority in XML:
`<PerspectiveCamera priority="0" />` … `<OrthographicCamera priority="10" />`.

**Raycasting & pointer events**

```ts
engine.raycast()                       // hits under the pointer (input.mouseNdc) → Intersection[]
engine.raycast({ ndc, objects, recursive })  // custom ray/targets
```

Components receive **Unity-style pointer hooks** — the engine raycasts on press/release and
bubbles the event up the hit object's ancestors:

```ts
class Button extends Component {
  override onPointerDown(e: PointerEventData) {}  // pressed over this object
  override onPointerUp(e: PointerEventData) {}    // released (delivered to the pressed object)
  override onPointerClick(e: PointerEventData) {} // press + release on the same object (tap/click)
  override onDrag(e: PointerEventData) {}         // held + moving after a press; e.delta = px moved
}
```

`PointerEventData` carries `{ object, point?, distance?, button, delta? }`. Driven by the
**mouse and single touch** (one finger maps to the primary pointer, so taps/drags work on
mobile — set CSS `touch-action: none` on the canvas); inert in editor mode.

**Scripted input** (tooling/tests/replays): `engine.input.injectKey` / `injectMouseButton` /
`injectMouseMove` / `injectScroll` / `injectGamepad` drive input with no DOM, committed on the
next `tick` exactly like real events.

**Tooling** — `engine.getSceneGraph()` returns a `SceneGraph` (`compiled` + `Object3D`/
`Component` ⇄ compiled-index maps) so an editor can patch live edits back to source.

### `Component`

```ts
abstract class Component<TNode extends Object3D = Object3D>
```

Type the host node for cast-free access: `class Rig extends Component<PerspectiveCamera> { … this.node.fov … }`.

**Fields:** `node: TNode` · `engine: Engine` · `id?: string` · `enabled: boolean`
(setting it runs `onEnable`/`onDisable`).

**Methods:** `getComponent(Type): T | null` · `destroy()`.

**Lifecycle hooks** (all optional, in order):

```ts
onLoad()                  // once, on attach (refs already wired)
onEnable()                // on enable (incl. right after onLoad)
start()                   // once, first update while enabled
update(dt)                // every frame while enabled
fixedUpdate(fixedDt)      // 0..N times/frame at the fixed step (physics)
lateUpdate(dt)            // after every component's update this frame (camera follow)
onDisable() / onDestroy()
```

### `System`

```ts
@system(RigidBody)
class PhysicsSystem extends System<RigidBody> {
  override onAttach() { /* build the world */ }
  override fixedStep(dt: number) { for (const rb of this.components) { /* … */ } }
}
```

The engine auto-runs a registered system while the scene contains its component type, keeping
`this.components` in sync. Hooks: `onAttach` · `fixedStep(dt)` · `step(dt)` · `onDetach`.

### `InputManager`

`engine.input`, sampled once per `tick`; `getKeyDown`/`getKeyUp` are true for exactly one
frame. Headless-safe (neutral values with no DOM).

```ts
input.getKey('Space'); input.getKeyDown('KeyW'); input.getKeyUp('Escape'); input.anyKey;
input.getAxis('Horizontal'); input.getAxis('Vertical');           // -1..1 from arrows/WASD
input.mousePosition; input.mouseNdc; input.mouseDelta; input.mouseScrollDelta; // Vector2
input.getMouseButton(0); input.getMouseButtonDown(0); input.getMouseButtonUp(2);
const pad = input.getGamepad(0); pad?.getButton('A'); pad?.getButtonDown('Start');
```

### decorators

```ts
@component({ name, description, order? })  // behaviour class → an XML <Tag> in <Components>
@node({ name, description, kind?, children? })   // a Three.js Object3D tag
@attachment({ name, description, target, group, unique?, required?, children? })  // geometry/material/setting
@system(ComponentType)                    // batch processor for that component type
@executeInEditor                          // also run this component in editor mode

@property({ type, description, ... })      // declare an XML-exposed field
```

**`description` is mandatory** on every `@component`, `@node`, `@attachment`, and `@property`
— it is the one-line summary people, the editor, and agents/RAG read to understand the API.
The type checker requires it, and the registry rejects a missing/empty one at load. (Because a
description is required, the old bare `@property(SomeComponent)` / `@property([Type])` shorthand
is gone — pass the reference as `type` in the object form.)

`@property` forms (all carry a `description`):

```ts
@property({ type: 'float', default: 1, description: 'Radians/sec' }) speed = 1;        // scalar
@property({ type: 'vec3', default: [0, 1, 0], description: 'Local offset' }) offset = new Vector3(0, 1, 0);
@property({ type: 'color', default: '#ff8800', description: 'Tint' }) tint = 0xff8800;
@property({ type: ['float'], description: 'Lane weights' }) weights: number[] = [];     // array, written "1 2 3"
@property({ type: TargetComponent, description: 'Node to track' }) target!: TargetComponent; // typed reference (#id)
@property({ type: 'prefab', description: 'Brick to spawn' }) brick: PrefabRef | null = null;
@property({ type: MySideEnum, default: 'front', description: 'Which faces render' }) side = FrontSide; // enum
```

Scalar `type`s: `float` · `int` · `bool` · `string` · `vec2` · `vec3` · `euler` · `color`,
plus `node` / `prefab` and an `EnumDef`. **Math props are forgiving and consistent** — a
`vec2`/`vec3`/`euler` default (or field initializer) may be an array `[x,y,z]`, a
`THREE.Vector3`/`Vector2`/`Euler`, or `{x,y,z}`; a `color` may be `0xRRGGBB`, a `"#rrggbb"`
string, or a `THREE.Color`. At runtime the field is **always** the Three type
(`Vector3`/`Vector2`/`Euler`/`Color`), whether the attribute was set in XML or left at its
default — so you can always write `this.offset.x` without checking the shape.

### `enumOf`

Register a set of named choices as a `@property` type. The field holds the **native value**;
XML/XSD/editor surface the member **names**. Three input forms:

```ts
import { enumOf } from '@scenoco-three/core';
import { FrontSide, BackSide, DoubleSide } from 'three';

enumOf('Side', { front: FrontSide, back: BackSide, double: DoubleSide }); // value map
enumOf('Kind', MyTsEnum);                                                 // native TS enum
enumOf('UniformType', ['float', 'int', 'vec2']);                          // identity (name == value)
```

Helpers: `isEnumType(x)` · `getEnum(name)` · `allEnums()`.

### assets (textures & models)

External assets are referenced by **URL** in a `@property({ type: 'string', asset })` field,
loaded into `engine.assets` (a URL-keyed `AssetCache`) by a preload provider, and read by the
attachment at attach. Built-in support:

```xml
<Mesh><BoxGeometry /><MeshStandardMaterial map="brick.png" normalMap="brick_n.png" /></Mesh>
<Group><Model src="hero.glb" /></Group>   <!-- glTF/GLB loaded as a cloned child subtree -->
```

```ts
await engine.loadSceneAsync(bundle); // textures/models load before onLoad (see Scene lifecycle)
engine.assets.registerLoader(['ktx2'], async (url) => /* custom loader */); // extend formats
```

Loaders are picked by extension (images → `TextureLoader`; `.glb`/`.gltf` → a lazily-imported
`GLTFLoader`, so a model-free build never ships the glTF addon). Cache-owned resources are
shared across scenes and freed by `engine.assets.dispose()` — scene unload leaves them intact.
Declare your own asset attrs with `@property({ type: 'string', asset: 'texture' | 'model' })`;
`collectAssetRefs(scene)` enumerates them. With `loadSceneAsync` assets are ready before
`onLoad`; with synchronous `loadScene` they **stream in** and appear when their load finishes.
The `@scenoco-three/vite` plugin rewrites local asset URLs to bundler-served assets (hashed +
HMR-watched); absolute/`public` URLs are fetched as-is.

### registry

`Registry` (components) and the node/attachment registry. Built-in tags self-register on
import; projects add their own the same way.

```ts
import { Registry, getNodeDef, nodeTags, getAttachmentDef, attachmentTags } from '@scenoco-three/core';
Registry.getComponent('Rotator'); Registry.componentNames();
nodeTags(); getNodeDef('Mesh'); attachmentTags(); getAttachmentDef('BoxGeometry');
```

### `PrefabRef`

What a `@property({ type: 'prefab' })` field receives — a handle that spawns a
build-time-embedded prefab:

```ts
@property({ type: 'prefab' }) brick: PrefabRef | null = null;
// …
const root = this.brick!.spawn({ position: [x, y, 0] }); // parent defaults to this.node
// later: this.engine.destroy(root);  // you own spawned subtrees
```

### bundle

```ts
import { deserializeBundle, instantiateScene, BUNDLE_VERSION, bundleKind } from '@scenoco-three/core';
const compiled = deserializeBundle(bundle);   // Bundle → CompiledScene
const live = instantiateScene(compiled, ctx); // CompiledScene → Three.js objects
```

You rarely call these directly — `engine.loadScene` / `engine.instantiate` do it. Types
(`CompiledScene`, `CompiledNode`, `CompiledComponent`, `CompiledAsset`, `CompiledUniform`,
`Bundle`, …) are exported for tooling. `ShaderMaterial` uniforms use the `UNIFORM_TYPES` /
`UniformType` set (custom GLSL with `<Uniform>` children, validated at compile time).

---

## Standalone & dependencies

**Zero runtime dependencies** (`three` is the only peer). Core is usable entirely on its own:
author components in TypeScript, build a `THREE.Scene` — either by [attaching components to
Three.js objects by hand](#or-build-the-scene-by-hand--no-compiler-no-bundle) or by loading a
**compiled bundle** (produced by `@scenoco-three/compiler` at build time) — and drive the
gameplay loop. No XML parser, validator or CLI ever reaches the browser. Everything above core
(`compiler`, `vite`, `editor`, `rapier`, `box2d`) is **optional** and builds on its public
seams — the registry decorators and the `System` API.

See the [repository](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md) for the
full design.

## License

[MIT](./LICENSE)
