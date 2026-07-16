# @scenoco-three/core

The **runtime** of [SceNoCo](https://github.com/) — a component-based scene framework for
[Three.js](https://threejs.org). It adds a Unity/Cocos-shaped layer — *Scene · Node · Component ·
System*, a game loop, and lifecycle hooks — directly on top of Three.js, with no wrapper objects:
**a node _is_ a `THREE.Object3D`**.

```bash
npm i @scenoco-three/core three
```

**What core gives you**

- **Components** with a Unity lifecycle (`onLoad`/`start`/`update`/`fixedUpdate`/`lateUpdate`/…),
  attached to any `THREE.Object3D`.
- **The component API on the node** — `node.getComponent(T)`, `node.addComponent(T)`, Cocos/Unity style.
- **A game loop** — variable + fixed timestep, `timeScale`, deterministic RNG, driven manually (headless) or by `requestAnimationFrame`.
- **Systems** — batch processors for one component type (physics, etc.), on a public seam.
- **Input, raycasting & pointer events**, prefabs/dynamic spawning, and async asset loading.
- **Scenes from a compiled bundle _or_ built by hand** — the runtime only cares about Three.js
  objects and the components on them. **No XML parser/validator ships here** — that's
  `@scenoco-three/compiler`, build time only.

**Contents** — [Quick start](#quick-start) · [Build a scene by hand](#build-a-scene-by-hand) ·
[The component API is on the node](#the-component-api-is-on-the-node) · [Concepts](#concepts) ·
[API reference](#api-reference)

---

## Quick start

Define a component, then load a scene the compiler produced:

```ts
import { Engine, Component, component, property, ValueType } from '@scenoco-three/core';
import sceneBundle from './scene.bundle.json'; // built by @scenoco-three/compiler

@component({ name: 'Rotator', description: 'Spins the host around Y' })
export class Rotator extends Component {
  @property({ type: ValueType.Float, default: 1, description: 'Radians/sec' })
  speed = 1;

  override update(dt: number) {
    this.node.rotation.y += this.speed * dt; // this.node IS a THREE.Object3D
  }
}

const engine = new Engine({ canvas: document.querySelector('canvas')! });
engine.loadScene(sceneBundle); // builds the THREE.Scene + wires every component
```

Headless (tests, servers) — omit the canvas and step the loop yourself:

```ts
const engine = new Engine();            // no renderer
engine.loadScene(sceneBundle);
engine.tick(1 / 60);                    // advance one frame
engine.findObject('ball');              // THREE.Object3D | undefined (by scene id)
engine.dispose();
```

## Build a scene by hand

You don't need a compiler or a bundle to use components. `engine.scene` is a real `THREE.Scene`
from construction, so you can populate it with plain Three.js objects and attach components with
the **node API** — the same `node.addComponent` you'd use anywhere. Attached components get the
full lifecycle immediately (`onLoad`/`onEnable` now, `start`/`update`/… on `tick`):

```ts
import * as THREE from 'three';
import { Engine } from '@scenoco-three/core';
import { Rotator } from './Rotator';

const engine = new Engine({ canvas: document.querySelector('canvas')! });

const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
engine.scene.add(cube);                       // plain Three.js — no wrapper
const rotator = cube.addComponent(Rotator, { speed: 2 }); // attach + run onLoad now
//              cube.addComponent('Rotator', { speed: 2 })  // …or by registered name

const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(2, 4, 3);
engine.scene.add(light);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.z = 5;
engine.scene.add(camera);
engine.mainCamera = camera;                   // the loop draws through this

engine.start();                               // rAF loop (or engine.tick(dt) by hand)

// Manipulate components on any node at runtime:
cube.getComponents();                 // readonly Component[] on this node
rotator.enabled = false;              // runs onDisable
rotator.destroy();                    // runs onDisable + onDestroy (deferred to end of tick)
```

Bundles and hand-built objects coexist: you can `engine.loadScene(bundle)` and still
`cube.addComponent(...)` onto objects you add yourself, or skip bundles entirely.

## The component API is on the node

Because a node is a `THREE.Object3D`, the component-manipulation methods live **on the node**
(Unity `GameObject` / Cocos `Node`), not on some wrapper. Inside a component you reach them through
`this.node`:

```ts
this.node.getComponent(RigidBody);              // first of a type on this node, or null
this.node.getComponents();                      // every component on this node
this.node.getComponentInChildren(Light);        // first on this node or any descendant (self-inclusive)
this.node.getComponentsInChildren(Collider);    // all, self + descendants
this.node.addComponent(Health, { hp: 100 });    // attach one (by class or 'Name')
this.node.removeComponent(other);               // remove one (deferred, like destroy())
```

These work on **any node in the engine's scene tree** — whether it came from a loaded scene, a
spawned prefab, or you built it and added it under `engine.scene`. A detached node (not in any
engine) throws a clear error rather than silently returning null; test with `node.isSceneAttached`.
Queries never return a component that's been destroyed this tick.

## Concepts

| Concept | What it is |
| --- | --- |
| **Node** | A `THREE.Object3D` — used directly, **no wrapper**. It carries the component API (`node.getComponent`, `node.addComponent`, …). |
| **Component** | Behaviour attached to a node (Unity `MonoBehaviour` / Cocos `cc.Component`). Its own surface is just lifecycle hooks + `enabled` + `destroy()`. |
| **System** | A batch processor for all components of one type (physics, etc.), on a public seam. |
| **Attachment** | Leaf config on a node: geometry, material, or a `<Scene>` setting (fog/background). |
| **Bundle** | The compiled, indexed scene the runtime loads. The runtime never sees XML. |
| **Prefab** | A reusable subtree spawned at runtime via `engine.instantiate()` or a `PrefabRef`. |

The registry decorators (`@component`/`@node`/`@attachment`/`@system`/`@property`) are the single
source of truth — the compiler, validator, and exporters are generated views of the same metadata,
so the schema can never drift from the code.

**Deferred destruction** — `destroy()`, `node.removeComponent()`, and `engine.destroy(subtree)` all
mark their target dead immediately (every later phase skips it) but run teardown (`onDisable`/
`onDestroy`, GPU free) at the **end of the tick**. So destroying something inside a hook — a bullet
despawning on hit — never corrupts a loop that's mid-iteration.

---

## API reference

- [`Engine`](#engine) · [`Component`](#component) · [Node API](#node-api-object3d) · [`System`](#system) ·
  [`InputManager`](#inputmanager) · [decorators](#decorators) · [`@property` & `ValueType`](#property--valuetype) ·
  [`enumOf`](#enumof) · [assets](#assets) · [registry](#registry) · [`PrefabRef`](#prefabref) · [bundle](#bundle)

### `Engine`

```ts
new Engine(options?: EngineOptions)
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `canvas` | `HTMLCanvasElement` | — | Render target. Omit for headless. |
| `autoStart` | `boolean` | `true` | Start the rAF loop when a canvas is given. |
| `fixedTimeStep` | `number` | `1/60` | Seconds per fixed step (`fixedUpdate`, physics). |
| `seed` | `number` | time-based | Seed for the deterministic RNG (reproducible runs). |
| `editor` | `boolean` | `false` | Editor mode (semi-internal, for the editor): instantiate but run no hooks except `@executeInEditor`. |
| `preserveDrawingBuffer` | `boolean` | `false` | Keep the buffer so `canvas.toDataURL()` can capture a frame. |

**Properties:** `scene: THREE.Scene` · `renderer?: WebGLRenderer` · `mainCamera?: Camera` (first
camera found in the scene; the loop draws through it) · `input: InputManager` · `assets: AssetCache` ·
`editorMode: boolean`.

**Scene lifecycle**

```ts
engine.loadScene(bundleOrCompiledScene)         // synchronous full swap; wires all refs before any onLoad
await engine.loadSceneAsync(bundleOrCompiledScene) // awaits preload providers (assets) first, then instantiates
engine.disposeScene()                           // unload, free GPU resources, leave an empty scene
engine.dispose()                                // stop loop + destroy everything
```

`loadScene` stays synchronous (assets stream in afterward); use `loadSceneAsync` only when a
component's `onLoad` must see its assets already loaded. Register a `PreloadProvider` (an asset
package does this) and the engine awaits it before `onLoad`:

```ts
engine.addPreloadProvider(async (compiled) => { /* load this scene's assets into a cache */ });
await engine.loadSceneAsync(bundle);            // assets ready before any onLoad runs
```

**Components** — the node API (above) is the idiomatic way; the engine also exposes the same
operations plus scene-wide queries:

```ts
engine.addComponent(node, Rotator, { speed: 2 })  // same as node.addComponent(Rotator, …); by class or 'Name'
engine.getComponents(node)                         // readonly Component[] on a node
engine.getComponentsOfType(Type)                   // every live instance of a type (Unity FindObjectsByType)
engine.findComponent(id, type?)                    // by scene id; type may be a class or a name string
engine.findObject(id)                              // Object3D by scene id — indexed (O(1)), traversal fallback
```

To remove: `component.destroy()` or `node.removeComponent(component)` (a single component), or
`engine.destroy(subtreeRoot)` (a whole subtree) — all deferred.

**Execution order** (Unity Script Execution Order): `@component({ order })` runs components in
ascending `order` across every phase; equal orders keep instantiation order. Default 0.

**Loop (headless or manual)**

```ts
engine.tick(dt)   // pointer events → fixedUpdate ×N → start/update → lateUpdate → systems → render
engine.start()    // begin the requestAnimationFrame loop (needs a canvas)
engine.stop()
```

**Systems & attachments**

```ts
engine.addSystem(new PhysicsSystem())
engine.getSystem(PhysicsSystem)                // T | undefined
engine.findAttachment(Physics)?.gravity        // live singleton config attachment
```

**Prefabs / dynamic spawning**

```ts
const root = engine.instantiate(prefabBundle, parent?)  // Unity Instantiate; returns the subtree root
await engine.instantiateAsync(prefabBundle, parent?)    // same, awaiting the prefab's assets first
engine.destroy(root)                                    // remove a subtree + its components (deferred)
```

**Time & timeScale**

```ts
engine.timeScale = 0.5    // slow-mo; 0 pauses gameplay (update still runs, deltaTime = 0)
engine.time               // scaled seconds elapsed     · engine.deltaTime  — scaled dt this frame
engine.unscaledTime       // wall-clock seconds         · engine.frameCount — frames ticked
engine.interpolationAlpha // [0,1) blend into the next fixed step (physics reads it to de-jitter)
```

**Deterministic RNG** (seed via `new Engine({ seed })`) — reproducible runs/replays/QA. Prefer it
over `Math.random()`:

```ts
engine.random()            // [0, 1)
engine.randomRange(2, 5)   // [2, 5)
engine.randomInt(0, 6)     // 0..5
engine.reseed(42); engine.seed
```

**Cameras** — `engine.cameras` is every scene camera sorted by `priority` (Unity camera depth); the
render loop draws them **in order** — the first paints the background, later ones overlay
(depth-cleared) for UI/HUD passes. `mainCamera` (the first found, or set it yourself) is the one
used for raycasting/pointer.

**Raycasting & pointer events**

```ts
engine.raycast()                             // hits under the pointer (input.mouseNdc) → Intersection[]
engine.raycast({ ndc, objects, recursive })  // custom ray / targets
```

Components receive **Unity-style pointer hooks** — the engine raycasts on press/release and bubbles
the event up the hit object's ancestors:

```ts
class Button extends Component {
  override onPointerDown(e: PointerEventData) {}  // pressed over this object
  override onPointerUp(e: PointerEventData) {}    // released (delivered to the pressed object)
  override onPointerClick(e: PointerEventData) {} // press + release on the same object (tap/click)
  override onDrag(e: PointerEventData) {}         // held + moving after a press; e.delta = px moved
}
```

`PointerEventData` carries `{ object, point?, distance?, button, delta? }`. Driven by the **mouse
and single touch** (set CSS `touch-action: none` on the canvas for mobile); inert in editor mode.

**Scripted input** (tooling/tests/replays): `engine.input.injectKey` / `injectMouseButton` /
`injectMouseMove` / `injectScroll` / `injectGamepad` drive input with no DOM, committed on the next
`tick` exactly like real events.

**Tooling** — `engine.getSceneGraph()` returns a `SceneGraph` (`compiled` + `Object3D`/`Component` ⇄
compiled-index maps) so an editor can patch live edits back to source.

### `Component`

```ts
abstract class Component<TNode extends Object3D = Object3D>
```

Type the host node for cast-free access:
`class Rig extends Component<PerspectiveCamera> { … this.node.fov … }`.

**Fields:** `node: TNode` · `engine: Engine` · `id?: string` · `enabled: boolean` (setting it runs
`onEnable`/`onDisable`).

**Methods:** `destroy()` — deferred teardown. *Finding other components is done through the node
([Node API](#node-api-object3d)):* `this.node.getComponent(T)`, `this.node.getComponentInChildren(T)`, etc.

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

### Node API (`Object3D`)

Core augments `THREE.Object3D` with the component API — available on `this.node`, on the root of a
spawned prefab, or on any object you added to `engine.scene`:

```ts
node.getComponent(Type): T | null
node.getComponents(): readonly Component[]
node.getComponentInChildren(Type): T | null       // self + descendants, depth-first
node.getComponentsInChildren(Type): T[]            // self + descendants
node.addComponent(Type, props?) / addComponent('Name', props?): T   // attach + run onLoad now
node.removeComponent(instance): void               // deferred, like component.destroy()
node.isSceneAttached: boolean                      // is this node in an engine's scene?
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
`this.components` in sync (whether components arrive at load or spawn in later). Hooks: `onAttach` ·
`fixedStep(dt)` · `step(dt)` · `onDetach`.

### `InputManager`

`engine.input`, sampled once per `tick`; `getKeyDown`/`getKeyUp` are true for exactly one frame.
Headless-safe (neutral values with no DOM).

```ts
input.getKey('Space'); input.getKeyDown('KeyW'); input.getKeyUp('Escape'); input.anyKey;
input.getAxis('Horizontal'); input.getAxis('Vertical');            // -1..1 from arrows/WASD
input.mousePosition; input.mouseNdc; input.mouseDelta; input.mouseScrollDelta; // Vector2
input.getMouseButton(0); input.getMouseButtonDown(0); input.getMouseButtonUp(2);
const pad = input.getGamepad(0); pad?.getButton('A'); pad?.getButtonDown('Start');
```

### decorators

```ts
@component({ name, description, order? })          // behaviour class → an XML <Tag> in <Components>
@node({ name, description, kind?, children? })     // a Three.js Object3D tag
@attachment({ name, description, target, group, unique?, required?, children? }) // geometry/material/setting
@system(ComponentType)                             // batch processor for that component type
@executeInEditor                                   // also run this component in editor mode

@property({ type, description, ... })              // declare an XML-exposed field
```

**`description` is mandatory** on every `@component`, `@node`, `@attachment`, and `@property` — it's
the one-line summary people, the editor, and agents/RAG read to understand the API. The type checker
requires it, and the registry rejects a missing/empty one at load.

### `@property` & `ValueType`

A property's `type` is a **`ValueType` member** (Cocos Creator style), a **Component class** (a typed
reference), or an **`EnumDef`** (from `enumOf`). Wrap it in a one-element array for a list. Every form
carries a `description`:

```ts
import { ValueType } from '@scenoco-three/core';
import { Vector3, FrontSide } from 'three';

@property({ type: ValueType.Float, default: 1, description: 'Radians/sec' }) speed = 1;
@property({ type: ValueType.Vec3, default: [0, 1, 0], description: 'Local offset' }) offset = new Vector3(0, 1, 0);
@property({ type: ValueType.Color, default: '#ff8800', description: 'Tint' }) tint = 0xff8800;
@property({ type: [ValueType.Float], description: 'Lane weights' }) weights: number[] = [];   // array; written "1 2 3"
@property({ type: ValueType.Node, description: 'Target to track' }) target: Object3D | null = null;  // node ref (#id)
@property({ type: ValueType.Prefab, description: 'Brick to spawn' }) brick: PrefabRef | null = null;
@property({ type: TargetComponent, description: 'Component to track' }) tracked!: TargetComponent;   // typed reference
@property({ type: MySideEnum, default: 'front', description: 'Which faces render' }) side = FrontSide; // enum
```

`ValueType` members: `Float` · `Int` · `Bool` · `String` · `Vec2` · `Vec3` · `Euler` · `Color` ·
`Node` · `Prefab`. Each member's value *is* the canonical wire kind (`ValueType.Float === 'float'`),
so it's just a readable, refactor-safe stand-in for the string — the same value the compiler and
serializer use.

**Math props are forgiving and consistent** — a `Vec2`/`Vec3`/`Euler` default (or field initializer)
may be an array `[x,y,z]`, a `THREE.Vector3`/`Vector2`/`Euler`, or `{x,y,z}`; a `Color` may be
`0xRRGGBB`, a `"#rrggbb"` string, or a `THREE.Color`. At runtime the field is **always** the Three
type, whether set in XML or left at its default — so `this.offset.x` always works.

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

### assets

External assets are referenced by **URL** in a `@property({ type: ValueType.String, asset })` field,
loaded into `engine.assets` (a URL-keyed `AssetCache`) by a preload provider, and read by the
attachment at attach. Built-in support:

```xml
<Mesh><BoxGeometry /><MeshStandardMaterial map="brick.png" normalMap="brick_n.png" /></Mesh>
<Group><Model src="hero.glb" /></Group>   <!-- glTF/GLB loaded as a cloned child subtree -->
```

```ts
await engine.loadSceneAsync(bundle);           // textures/models load before onLoad
engine.assets.registerLoader(['ktx2'], async (url) => /* custom loader */); // extend formats
```

Loaders are picked by extension (images → `TextureLoader`; `.glb`/`.gltf` → a lazily-imported
`GLTFLoader`, so a model-free build never ships the glTF addon). Cache-owned resources are shared
across scenes and freed by `engine.assets.dispose()`. Declare your own asset attrs with
`@property({ type: ValueType.String, asset: 'texture' | 'model' })`; `collectAssetRefs(scene)`
enumerates them. With synchronous `loadScene`, assets **stream in** and appear when their load
finishes. The `@scenoco-three/vite` plugin rewrites local asset URLs to bundler-served assets
(hashed + HMR-watched).

### registry

`Registry` (components) and the node/attachment registry. Built-in tags self-register on import;
projects add their own the same way.

```ts
import { Registry, getNodeDef, nodeTags, getAttachmentDef, attachmentTags } from '@scenoco-three/core';
Registry.getComponent('Rotator'); Registry.componentNames();
nodeTags(); getNodeDef('Mesh'); attachmentTags(); getAttachmentDef('BoxGeometry');
```

### `PrefabRef`

What a `@property({ type: ValueType.Prefab })` field receives — a handle that spawns a
build-time-embedded prefab. `spawn(options)` mirrors Unity `Instantiate(prefab, position, rotation,
parent)` — **placement only**:

```ts
@property({ type: ValueType.Prefab, description: 'Brick to spawn' }) brick: PrefabRef | null = null;
// …
const root = this.brick!.spawn({ position: [x, y, 0] }); // parent defaults to this.node
// later: this.engine.destroy(root);                     // you own spawned subtrees
```

`position`/`rotation` accept **native Three.js types** (`Vector3`, `Euler`, `Quaternion`) or plain
`[x,y,z]` arrays (rotation arrays are radians) — the same value you'd set on any `Object3D`.

**Setting fields / wiring references on a spawned instance** is done the Unity/Cocos way — take the
returned root and use the node API:

```ts
const root = this.brick!.spawn({ position: p });
const ctrl = root.getComponent(Controller)!;             // component API on the node
ctrl.gameManager = this.engine.findComponent('gm', GameManager); // wire a scene reference
```

Or let the prefab's **own script** resolve the scene object in `start()`, Unity `FindObjectOfType` /
Cocos `find` style:

```ts
override start() {
  this.gameManager = this.engine.getComponentsOfType(GameManager)[0]   // FindObjectOfType
    ?? this.engine.findComponent('GameManager', GameManager);          // or find by id/name
}
```

> Author-time placement (a `<PrefabInstance>` in a scene) can wire prefab internals to scene objects
> declaratively with `<Override>` — see the [`@scenoco-three/compiler`](../compiler/README.md#prefabs) README.

### bundle

```ts
import { deserializeBundle, instantiateScene, BUNDLE_VERSION, bundleKind } from '@scenoco-three/core';
const compiled = deserializeBundle(bundle);   // Bundle → CompiledScene
const live = instantiateScene(compiled, ctx); // CompiledScene → Three.js objects
```

You rarely call these directly — `engine.loadScene` / `engine.instantiate` do. Types
(`CompiledScene`, `CompiledNode`, `CompiledComponent`, `Bundle`, …) are exported for tooling.
`ShaderMaterial` uniforms use the `UNIFORM_TYPES` / `UniformType` set (custom GLSL with `<Uniform>`
children, validated at compile time).

---

## Standalone & dependencies

**Zero runtime dependencies** (`three` is the only peer). Core is usable entirely on its own: author
components in TypeScript, build a `THREE.Scene` — either by
[attaching components by hand](#build-a-scene-by-hand) or by loading a **compiled bundle** (produced
by `@scenoco-three/compiler` at build time) — and drive the loop. No XML parser, validator, or CLI
ever reaches the browser. Everything above core (`compiler`, `vite`, `editor`, `rapier`, `box2d`) is
**optional** and builds on its public seams — the registry decorators and the `System` API.

See the [repository](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md) for the full
design.

## License

[MIT](./LICENSE)
