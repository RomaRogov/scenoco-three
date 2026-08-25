# The SceNoCo document format

Seven kinds of file. Each compiles to a TypeScript module beside it (`*.gen.ts`, regenerated on
every build, gitignored). Every value is an **attribute** — nothing reads text between tags.

| File | Root element | Compiles to |
| --- | --- | --- |
| `x.texture.xml` | `<Texture>` | `export const x: Texture` |
| `x.geometry.xml` | a three.js geometry | `export const x` |
| `x.material.xml` | a three.js material | `export const x` |
| `x.particle.xml` | `<ParticleSystem>` | `export const x: ParticleConfig` |
| `x.render.xml` | `<Render>` | `export const x: RenderSettings` |
| `x.prefab.xml` | the node the prefab produces | `export class XPrefab extends <that node>` |
| `x.scene.xml` | `<Scene>` | `export class XScene extends Scene` |

## The rule

**An element is a class. Its attributes are that class's own properties.** Where three.js
declares the class, the spelling is three.js's — `<BoxGeometry width>` because `BoxGeometry`
takes a `width`, `<Scene background>` because a `Scene` has a `background`. Where it does not,
the class is one of yours or a package's, and you can see which by where it is written.

Two things follow, and between them they answer most questions about where something goes:

- **A bare element in a scene or prefab document is a node.** That is what those documents are —
  the tree. Anything that is not an `Object3D` lives in a named block (`<Components>`,
  `<Systems>`) or in a document of its own. There is no third case to remember.
- **Presence is the switch.** An effect is on because you wrote the element. No attribute takes
  a value that means "off", and no attribute quietly does nothing because a neighbouring one is
  zero.

A prefab and a scene are **suffixed**: `brick.prefab.xml` is `BrickPrefab`, `level-1.scene.xml`
is `Level1Scene`. It says what the name is at every use — and it is what lets a `hud.prefab.xml`
sit beside a `Hud` component, which is how anyone would name a matched pair.

Images, models and sounds have no document: they are already assets, so a path names the file
itself — see [Files](#files).

## Writing a value

**One spelling each.** Where a second one is plausible, the compiler answers with the exact
text to write instead — it never accepts both.

| Type | Write | Not |
| --- | --- | --- |
| number | `radius="0.3"` | |
| boolean | `looping="true"` | `"yes"`, `"1"` |
| string | `name="paddle"` | |
| colour | `color="#38bdf8"` | `"0x38bdf8"`, `"tomato"`, `"rgb(…)"`, `"hsl(…)"` |
| Vector2/3/4 | `position="x: 1; y: 2"` | `"1 2 0"` |
| rotation | `eulerAngles="y: 90"` — **degrees** | radians |
| uniform scale | `scale="2"` | |
| enum | `side="DoubleSide"` | `"2"` |
| a node in this document | `paddle="#paddle"` | |
| several | `bricks="[#b1, #b2]"` | |
| an asset | `geometry="../geometry/brick.geometry.xml"` | |
| a scene | `nextLevel="level-2.scene.xml"` — a field declared `SceneType` | |
| a file | `map="../textures/brick.png"` | |

A bracketed list works for **every** kind of value, not only references: `bricks="[#b1, #b2]"`,
`palette="[#38bdf8, #f472b6]"`, `waypoints="[x: 0; y: 1, x: 2; y: 3]"`. The field's declared
type decides — `Object3D[]`, `Color[]`, `Vector3[]` — and each entry is read exactly as a lone
value of that type would be.

A field declared `SceneType` holds a *scene class*, which is what `SceneManager.load` takes:

```ts
export class Goal extends Component {
  nextLevel!: SceneType;                          // authored as a path
  finish() { void SceneManager.load(this.nextLevel); }
}
```

Where a property genuinely takes more than one kind — `<Scene background>` is a colour *or* a
texture — the text decides which, and a value that is neither is an error listing both forms.

Omitted axes are zero: `position="y: 7"` is `(0, 7, 0)`.

`THREE.Color` itself takes far more than hex — `0x38bdf8`, the CSS colour names, `rgb(…)` and
`hsl(…)`. A document takes only hex, but the compiler reads all of them anyway and answers with
the exact hex to write, using three.js's own parser:

```text
color="tomato"           →  color="#ff6347"
color="green"            →  color="#008000"   ← not bright green; the hex says so
color="rgb(255, 99, 71)" →  color="#ff6347"
color="tomatoe"          →  nearest name "tomato"; write "#ff6347"
```

The last line is the reason the names are not simply accepted: three.js at runtime warns to the
console for an unknown name and leaves the colour as it was, so a typo renders.

## Every node takes these

`id` `name` `position` `eulerAngles` `scale` `visible` `active` `dontDestroyOnLoad`

They are applied in that order whatever order you write them in, so a document means one thing.
`visible="false"` hides a node that keeps updating; `active="false"` turns the whole subtree
off — no hooks, no rendering — and always wins over `visible`.

An `id` becomes a typed field on the generated class: `id="paddle"` gives you `this.paddle`,
and `#paddle` anywhere in the document refers to it.

`dontDestroyOnLoad="true"` is Unity's, with Unity's meaning: the node moves into the persistent
scene, so it survives every later `SceneManager.load` and is drawn over whatever is active.
It keeps its components and its children — and it comes with Unity's caveat, that **two scenes
each declaring a persistent node produce two of it**. For anything a whole game shares, mark
the *scene* instead (below): `loadAdditive` of an already-loaded scene does nothing, so every
level may ask for it and exactly one exists.

## A scene

```xml
<Scene>
  <Systems>
    <Physics2D gravity="x: 0; y: 0" />
  </Systems>

  <PerspectiveCamera id="cam" fov="45" near="0.1" far="200" position="y: 7; z: 20" />
  <AmbientLight intensity="0.5" />

  <Mesh id="paddle"
        geometry="../geometry/paddle.geometry.xml"
        material="../materials/paddle.material.xml"
        position="y: 0.5">
    <Components>
      <PaddleController speed="10" halfRange="6" />
    </Components>
  </Mesh>

  <Prefab src="brick.prefab.xml" id="b1" position="x: -6.75; y: 12" />
  <Prefab src="brick.prefab.xml" id="b2" position="x: -4.05; y: 12" />
</Scene>
```

The scene renders through `scene.mainCamera`, so a document has to say which camera that is —
except that it usually doesn't. **Declare one camera and it is chosen for you**; declare two and
write `<Scene camera="#cam">`, because then the choice is real.

- `<Systems>` — scene services (a physics world, an audio bus). Only at the scene root, and
  only in a scene. One of each class.
- `<Components>` — behaviour on the node it sits inside. Any node, any depth.
- `<Prefab src="…">` — spawns a prefab. `src`, the placement attributes, `dontDestroyOnLoad`,
  and `<Override>` children.

Everything else under `<Scene>` is a node, at any depth. How the scene *looks* — fog, tone
mapping, bloom — is a [render document](#how-a-scene-is-drawn) it names, not an element in the
tree.

### What `<Scene>` takes

Two closed sources, and nothing else:

- **The properties `THREE.Scene` declares** — `background`, `environment`, `backgroundBlurriness`,
  `overrideMaterial`, and the rest. If three.js has it, it is an attribute here; if three.js does
  not, it is an error. (A `Scene` is an `Object3D`, so it inherits `castShadow` and friends too.
  Noise, but three.js's noise — nothing to learn.)
- **The engine's four**: `camera`, `render`, `dontDestroyOnLoad`, `disposeOnUnload`.

```xml
<Scene camera="#camera" background="#05070d" render="../render/neon.render.xml">
```

Tone mapping, shadows, bloom and fog used to be attributes here. They are not properties of a
`THREE.Scene` — `scene.toneMapping` does not exist, `renderer.toneMapping` does — so they were
SceNoCo ideas wearing three.js's clothes, indistinguishable from the real ones. And `bloom="0"`
had to mean *off*, which left `bloomRadius` sitting beside it doing nothing at all. They live in
a render document now.

### A camera that fits the window

A game is authored against a playfield and drawn into whatever shape the window is. `CameraFit`
is the rule for that — a component, because three.js has no such concept and a document should
be able to tell the two apart:

```xml
<OrthographicCamera position="z: 20">
  <Components>
    <CameraFit mode="contain" width="18" height="24" />
  </Components>
</OrthographicCamera>
```

`contain` shows the whole `width` × `height` frame, letterboxing the axis with slack; `cover`
fills the canvas and crops; `width` and `height` pin one axis. State only one of the two and it
decides on its own. With it attached the projection is *derived* — a perspective camera's `fov`,
an orthographic camera's frustum — so whatever they were authored as is overwritten, and
`distance` says how far in front of a perspective camera the frame sits (by default, its own
distance from the origin).

### A system that reads the scene

A `<Systems>` entry takes node references like anything else:

```xml
<Systems>
  <Rules goal="#goal" spawns="[#s1, #s2]" />
</Systems>
```

Systems are **added before the tree is built**, so a component woken by a spawned prefab finds
the configured system rather than making a default one — which means those references are
assigned *after* the tree, once the nodes exist. Read them in `start()`, which runs once, after
every component in the scene has had `awake` and `start`. Reading them in `awake` gets you
`undefined`.

## How a scene is drawn

```xml
<!-- assets/render/neon.render.xml -->
<Render>
  <Fog color="#05070d" near="20" far="46" />
  <ToneMapping curve="ACESFilmicToneMapping" exposure="1.05" />
  <Shadows />
  <Bloom strength="0.75" radius="0.5" threshold="0.72" />
</Render>
```

Each child is one thing that decides how the frame looks, and it is on **because the element is
there** — to turn it off, delete the line. `<Render>` itself takes no attributes.

A scene names one with `render="…"`, and every scene that names it shares one look, so tuning a
game is one file rather than the same six values copied into every level.

| Tag | From | |
| --- | --- | --- |
| `<Fog>` `<FogExp2>` | three.js | `scene.fog`, with three.js's own parameters |
| `<ToneMapping curve exposure>` | `@scenoco-three/postfx` | the tone curve; `curve` takes three.js's constants |
| `<Shadows enabled type>` | `@scenoco-three/postfx` | `renderer.shadowMap` |
| `<Bloom strength radius threshold>` | `@scenoco-three/postfx` | glow, via three.js's `UnrealBloomPass` |
| `<Vignette offset darkness>` | `@scenoco-three/postfx` | darkened corners |

An effect is an ordinary class — public fields are its attributes, exactly like a component's —
so a package can add one and a project can write one. Effects that contribute a post-processing
pass make the engine build an `EffectComposer`; a project whose scenes declare none never loads
a byte of three's postprocessing addons.

Fog is in this document and not in the scene for the rule at the top: under `<Scene>`, every
bare element is a node, and `Fog` is not one.

## A prefab

The root element **is** the node the prefab produces. There is no wrapper.

```xml
<Mesh geometry="../geometry/brick.geometry.xml"
      material="../materials/brick.material.xml">
  <Components>
    <Brick points="10" />
  </Components>
</Mesh>
```

That compiles to `class BrickPrefab extends Mesh`, so a spawned brick *is* a `Mesh` — its
collider and material sit on the root, with no extra transform in between.

### Overriding one spawn

A prefab exists to be spawned many times, and the instances differ. `<Override>` is how one
spawn differs, and it is the **only** way into a prefab from outside it:

```xml
<Prefab src="brick.prefab.xml" position="x: -4; y: 12">
  <Override target="#brick" hits="3" />
  <Override target="#body" material="../materials/brick-hard.material.xml" />
  <Components>
    <Wobble amplitude="0.2" />
  </Components>
</Prefab>
```

- `target="#id"` names something the **prefab** gave an id to — a node or a component. A prefab
  with no ids exposes nothing, which is deliberate: what is adjustable is what the prefab chose
  to name.
- Every other attribute is a property to set, checked against the same field list that would
  check it inside the prefab. A misspelt target, a misspelt attribute or a wrong value is a
  build error here, at this line — not a surprise at run time.
- The override runs after the prefab has built itself and **before anything in it wakes up**, so
  a value set here is the value every `awake` sees.
- A constructor attribute counts too — `<Mesh geometry material>` is passed to `new Mesh(…)` in
  the prefab, and swapping one spawn's material is the most ordinary override there is. The
  exception is the handful of slots three.js reads exactly once (an `InstancedMesh`'s `count`);
  those assign without effect, exactly as they would in hand-written code.
- `<Components>` on a spawn adds behaviour to *this* copy. That is not an override of anything —
  it is the instance being a node like any other.

## A geometry, a material

One element, no children. Each compiles to a module-scope value, so every document that
references it shares one instance.

```xml
<!-- assets/geometry/brick.geometry.xml -->
<BoxGeometry width="1.2" height="0.4" depth="0.5" />

<!-- assets/materials/brick.material.xml -->
<MeshStandardMaterial color="#e9c46a" emissive="#3a2f10" roughness="0.5" metalness="0.1" />
```

There is no inline geometry or material. A mesh points at an asset, the way Unity's MeshFilter
points at a mesh and its MeshRenderer at a `.mat`.

## Files

An image, a glTF model and a sound are already assets — they have a path and there is nothing to
author about them — so a path names the file itself. Unity's arrangement: you drop the file in
and reference it.

```xml
<MeshStandardMaterial map="../textures/brick.png" roughness="0.6" />

<Prefab src="../models/hero.glb" position="y: 1" id="hero" />

<Components>
  <AudioSource clip="../audio/engine.ogg" loop="true" spatial="true" />
</Components>
```

- **Images** — `.png .jpg .jpeg .webp .avif .bmp .gif`. One texture per file, however many
  materials name it.
- **Models** — `.glb .gltf`. A model *is* a prefab: same `<Prefab src>`, same placement, no
  wrapper node. Needs `@scenoco-three/core`.
- **Sounds** — `.mp3 .ogg .wav .m4a .aac .flac`. Needs `@scenoco-three/audio`.

A model and a sound have to arrive before the scene can use them, so a scene that names one gets
an `async onLoad` that awaits them — you never write the load call. A prefab cannot await
(`instantiate` is synchronous), so it publishes `static assets` and whoever spawns it waits. From
code: `await loadAssets(...Enemy.assets)`.

A path that is neither a document nor a file that exists is `unknown-asset`, at build time.

## A texture

The one file kind with a document, because sampler settings are real, belong to the texture
rather than to whoever uses it, and a wrong `colorSpace` is the usual reason a scene looks washed
out. Use the image directly when the defaults are fine.

```xml
<!-- assets/textures/floor.texture.xml -->
<Texture src="floor.png" colorSpace="SRGBColorSpace" wrapS="RepeatWrapping" anisotropy="8" />
```

```xml
<MeshStandardMaterial map="../textures/floor.texture.xml" roughness="0.8" />
```

`src` is the image. Every other attribute is a property of three.js's own `Texture`.

## A particle effect

Also an asset, and referenced the same way. Its child elements are Unity's Shuriken modules.

```xml
<!-- assets/vfx/fire.particle.xml -->
<ParticleSystem duration="3" startLifetime="1.6" startSpeed="4.5" startColor="#ffdd66">
  <Emission rateOverTime="90"><Burst time="0" count="10" /></Emission>
  <Shape type="Cone" radius="0.35" angle="14" />
  <ColorOverLifetime colors="[#ffee88, #ff6622, #661100]" />
  <SizeOverLifetime curve="[0.4, 1, 0.2]" />
</ParticleSystem>
```

```xml
<Group position="y: 1.2">
  <Components>
    <ParticleSystem effect="../vfx/fire.particle.xml" />
  </Components>
</Group>
```

Needs `@scenoco-three/particles`. The attributes come from that package's `ParticleConfig`, the
same way a material's come from three.js.

## UI

Needs `@scenoco-three/ui`. Placement is Unity's RectTransform: **an anchor preset, two offsets,
two sizes** — every value a number, a colour or a short enum.

```xml
<PerspectiveCamera id="cam" position="z: 10">
  <Canvas>
    <Panel anchor="stretchTop" height="64" background="#111827"
           layout="horizontal" alignY="center" gap="12" padding="16">
      <Text id="score" text="SCORE 0" fontSize="20" color="#ffffff" />
    </Panel>

    <Panel anchor="center" width="360" height="220" background="#1f2937" radius="12"
           layout="vertical" alignX="center" alignY="center" gap="16">
      <Text text="Paused" fontSize="32" />
    </Panel>
  </Canvas>
</PerspectiveCamera>
```

| | |
| --- | --- |
| `anchor` | `topLeft` `top` `topRight` `left` `center` `right` `bottomLeft` `bottom` `bottomRight` `stretchTop` `stretchBottom` `stretchLeft` `stretchRight` `stretch` |
| `x` `y` | pixels **in** from the anchored edge; at a centre anchor, an offset from centre |
| `width` `height` | pixels — leave off a stretched axis, where the stretch *is* the size |
| `layout` | `vertical` `horizontal` — which way children stack |
| `alignX` `alignY` | `start` `center` `end` `stretch` `between` — always horizontal / vertical, whichever way `layout` runs |
| `gap` `padding` | pixels |
| `background` `radius` `border` `borderColor` `opacity` | the rectangle |
| `color` `fontSize` `fontWeight` `textAlign` | text, inherited by everything inside |

Writing an `anchor` pins the element and takes it out of the parent's layout; leave it off and the
parent places it.

- `<Canvas>` — the screen root. A child of the camera node; lays out in screen pixels.
- `<Panel>` — a rectangle holding others. On its own, world-space UI placed with `position`.
- `<Text>` — takes `text`.
- `<Image>` — takes `src`, an image file like a material's `map`.

## Where the vocabulary comes from

Nothing here is a list maintained in this repo.

- **Node, geometry and material tags** are three.js's exported classes. A geometry's attributes
  *are* its constructor parameters (`BoxGeometry(width, height, depth, …)`); a material's are
  its parameters interface.
- **Component, system and effect tags** are classes extending `Component`, `System` or `Effect` —
  yours, or a package's. Their attributes are the class's public fields, with types and defaults
  read from the source. No decorator, no registration. The three differ only in where a document
  may write one: on a node, at the scene root, in a render document.

So `scenoco build` knows a tag exists because a class exists. A misspelling is a build error
naming the file and line, usually with the nearest real name.

## What the compiler will tell you about

Nothing is silently ignored. Beyond the value errors above:

| Code | Means |
| --- | --- |
| `unknown-tag` / `unknown-component` / `unknown-system` | no such class — with a suggestion |
| `unknown-attribute` | the class has no such field — with a suggestion |
| `missing-attribute` | a field declared `x!: T` with no default; nothing else can supply it |
| `unknown-id` | `#foo` points at an id nothing declares |
| `duplicate-id` | one id used twice |
| `wrong-host` | a `Component<PointLight>` on something that is not one |
| `misplaced-systems` / `systems-in-prefab` | a `<Systems>` block nothing would read |
| `text-content` | text between tags; every value is an attribute |
| `renamed-tag` | v1's `<PrefabInstance>`, with the new spelling |
| `ambiguous-camera` / `not-a-camera` | two cameras and no `<Scene camera="#id">`, or one pointing at something that is not a camera |
| `unknown-asset` | a path that resolves to no document in this project |
| `not-a-prefab` | `<Prefab src>` pointing at a scene — a scene is loaded, not spawned |
| `unknown-target` / `missing-target` | an `<Override>` naming an id the prefab does not declare, or naming none |
| `nested-override` / `empty-override` | an override of a prefab spawned inside a prefab, or one that sets nothing |
| `misplaced-override` | an `<Override>` outside the `<Prefab>` it overrides |
| `misplaced-fog` | a `<Fog>` in the tree, where every bare element is a node — it belongs in a render document |
| `duplicate-fog` | a second `<Fog>` in one render document |
| `unknown-effect` | a `<Render>` child that is not an effect — with a suggestion, or the package that provides them |
| `persist-in-prefab` | `dontDestroyOnLoad` inside a prefab; it belongs on the `<Prefab>` that spawns it |
| `bad-union` | a value that is none of the forms the property takes |

Whatever slips past is caught by `tsc` on the generated file, which still names a file and a
line.
