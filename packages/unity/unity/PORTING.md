# Porting a SceNoCo game to this Unity project

`scenoco-unity` wrote the game here: its scenes and prefabs as Scenoco's text, which Unity builds
into `.unity` and `.prefab` assets; the meshes, materials, particle systems and post effects they use;
the page as UXML and USS; the input actions; the project's rendering settings — and the game's code as
C# stubs holding its TypeScript. What is left is the code, file by file. This card is the rules for
that; Diceload's `unity-game` skill (in `.claude/skills/`) is how you work in this project. It is
rewritten by every export.

## What is here

- `Assets/Prefabs/*.uprefab`, `Assets/Scenes/*.uscene`: the prefabs and scenes as text, each beside
  the asset Scenoco (`com.roro.scenoco`) builds from it. Read its `AGENTS.md` before changing one:
  it is how a scene is written, and what to do with an error at a line. A scene's fog and ambient
  light are on the scene, not in its text.
- `Assets/Meshes`, `Assets/Materials`, `Assets/Textures`, `Assets/Terrains`: what the text names, made
  by the importer (**SceNoCo ▸ Import**, or by itself after an export compiles). Its Console lines
  list what did not come across, and each text twin that Scenoco could not build, with its line.
  Read every warning.
- `Assets/Scripts/<Behaviour>.cs`: one stub per behaviour. Its wired fields are real C# fields, and the
  prefabs already set them; keep their names. Every other field, and every method, holds its
  TypeScript as comments; so does the code its file holds outside the class. Write the C# in its
  place and delete the comment. A stub compiles as it is, so port one at a time and keep the project
  compiling. Stubs are written once and never overwritten.
- `Assets/Scripts/Modules/*.cs`: every other module of the game — helpers, tables, the entry
  `main.ts` — as its TypeScript in comments. Decide what each becomes (below).
- `Assets/UI`: the page — one `.uxml` per `UIDocument`, one per `<template>`, `Page.uss`, its images
  and its fonts. Rewritten by every export: change the page, not these.
- `Assets/Models`, `Assets/Audio`: the game's model and sound files. A placed model (`<Goblin />`) is
  a placed `.glb`, turned 180° about y for glTFast's mirror; a model code instantiates needs the same
  turn: `Instantiate(model, position, rotation * Quaternion.Euler(0, 180, 0))`. A model with settings
  (`sharedModel(url, { castShadow: false })`) is its variant, `Assets/Models/<name>.prefab`.
- `Assets/SceNoCo/Input/SceNoCo.inputactions`: the project-wide input actions.
- `Packages/manifest.json` has Scenoco and Diceload, which the export added.

## Code

- **Hooks are Unity's messages.** `awake` is `Awake`, `update` is `Update`, `onTriggerEnter` is
  `OnTriggerEnter`; the stub already names them, and `update(dt)`'s `dt` is `Time.deltaTime`. Other
  methods are PascalCase.
- **The world is mirrored on Z.** three.js is right-handed, Unity left-handed; the export negates z.
  Negate z in every vector literal and every z the code computes; a rotation about x or y turns the
  other way. `lookAt`, forward vectors and cameras need the same care. The prefabs are already
  mirrored: only code is left. A `Vector3` field a rotation is set from — degrees a second about each
  axis, a spin — came across mirrored as a rotation: x and y negated, z kept, so
  `transform.Rotate(speed * Time.deltaTime)` needs nothing more.
- **A node's `position`, `rotation` and `scale` are local**: `transform.localPosition`,
  `localRotation`, `localScale`. `getWorldPosition` is `transform.position`. `eulerAngles` are degrees
  on both sides; three's `rotation` is radians.
- **Behaviours read as Unity's already**: `getComponent<T>` is `GetComponent<T>()`, `instantiate`,
  `destroy`, `Time`, `Mathf`, `Random`, `sendMessage` keep their meaning. A prefab a behaviour
  instantiates is a `GameObject` field set to its prefab asset. `findObjectOfType` is
  `FindFirstObjectByType`, `findObjectsOfType` is `FindObjectsByType<T>()` (before Unity 6.6,
  `FindObjectsByType<T>(FindObjectsSortMode.None)`).
- **Tweens map to DOTween's calls**, once the project has the free DOTween (below, "Tweens"):
  `node.doMove(to, 0.5).setEase(Ease.OutBack)` is `transform.DOMove(to, 0.5f).SetEase(Ease.OutBack)`,
  `Tween.sequence().append(a).join(b)` is `DOTween.Sequence().Append(a).Join(b)`,
  `Tween.delayedCall(s, fn)` is `DOVirtual.DelayedCall(s, fn, false)`, `Tween.float` is `DOVirtual.Float`,
  `Tween.to(get, set, to, d)` is `DOTween.To(get, set, to, d)`, `tween.setLink(this)` is
  `.SetLink(gameObject)`, and `yield tween.waitForCompletion()` is `yield return tween.WaitForCompletion()`.
  A tween on a node ended with the node without being told: add `.SetLink(gameObject)`. A rotation
  given as a `Vector3` is degrees in both; an `Euler` was radians, so convert it.
- **Coroutines**: a `*generator` is an `IEnumerator`, `this.startCoroutine(this.x())` is
  `StartCoroutine(X())`, `yield new WaitForSeconds(s)` is the same, `yield null` waits a frame.
- **A scene's own behaviours** — written on its `<Scene>` — are on one object that holds the whole
  scene, as three's `Scene` does. `dontDestroyOnLoad(this)` there is `DontDestroyOnLoad(gameObject)`
  and keeps the scene, as it did. Unity keeps only a root object: on a child, it is
  `DontDestroyOnLoad(transform.root.gameObject)` — what SceNoCo kept, the topmost node.
- **Events**: an `Event<T>` field is a C# `event Action<T>`; `listen(e, f)` is `e += f`, and its
  removal belongs in `OnDestroy`.
- **Colours are `Color`**, as SceNoCo's are three's `Color`: a field the scenes wire comes across
  typed. A colour written as a string in TypeScript is a bug to fix in the game.
- **Materials**: three's `color`, `emissive` and `metalness` are URP Lit's `_BaseColor`,
  `_EmissionColor` and `_Metallic`, and `node.material` is `GetComponent<Renderer>().material` — a
  copy of its own, as a three material written in an element is. URP has no emissive intensity: the
  importer wrote `_EmissionColor` as the colour's linear value times it. Code that animates a glow
  keeps the colour, as the TSX wrote it, and sets `(color.linear * intensity).gamma`. When the game's
  code sets an emissive, every lit material has emission on — black where the TSX gave none — so a
  colour set at runtime glows; without the `_EMISSION` keyword, URP draws none.
- **Physics layers** came across: SceNoCo's layer n is Unity's user layer n + 7, named after the
  game's own constant (`Layer.ball`), set on the objects, and the pairs `ignoreLayerCollision` set are
  in the project's Physics settings. Code that names a layer adds 7.
- **Numbers**: `number` is `float`, or `int` where it counts. Keep the units: SceNoCo's are Unity's.
  A union field the scenes wire stays as its stub types it — `string`, `float` — so the prefabs keep
  their values. **Never change a wired field's type**: the scene's text would no longer read, and
  Scenoco says so at its line. If one must change, change the value in the text to match.
- **`onValidate` is `OnValidate`**, with nothing added: `Assets/Editor/SceNoCoValidate.cs` also calls
  it when the editor moves the object, or one a field holds, as SceNoCo does. Unity also calls it on
  load, on prefab assets and while several scenes are open: return unless `gameObject.scene.isLoaded`,
  find what it places by in that scene (its roots), and leave a value within a few mm as it is, or
  every load marks the scene changed. Creating or destroying objects there waits for `EditorApplication.delayCall`.
- **A missing component is a fake null**: `GetComponent<T>() ?? AddComponent<T>()` and `?.` never
  see it. Use `TryGetComponent`, or `== null`.
- **Particle systems** are Unity's own, module by module: `play()`, `stop()`, `isPlaying` are the same.
- **Terrains** are `TerrainData` assets on a child named Terrain at the data's corner: SceNoCo's is
  centred, heights in metres; Unity's starts at its object, heights 0..1 of `size.y`. `sampleHeight(p)`
  is `Terrain.SampleHeight(p)`, `data.heightAt(x, z)` is `SampleHeight` at that point under the node,
  `steepnessAt` is `terrainData.GetSteepness` at its 0..1 position. Unity's Terrain never rotates (it ignores
  its object's rotation): a terrain the game tilts is, in the port, its heights as a mesh with a MeshCollider.

## Input

SceNoCo's `Input` is Unity's Input Manager by name; here it is the Input System, which a URP project
uses alone. The named axes and buttons are actions of the same names in the project-wide actions —
no class of your own between the game and them:

| TypeScript | C# |
| --- | --- |
| `Input.getAxis('Horizontal')`, `getAxisRaw` | `InputSystem.actions["Horizontal"].ReadValue<float>()` |
| `Input.getButtonDown('Jump')`, `getButton`, `getButtonUp` | `InputSystem.actions["Jump"].WasPressedThisFrame()`, `IsPressed()`, `WasReleasedThisFrame()` |
| `Input.getKeyDown(KeyCode.Space)` | `Keyboard.current.spaceKey.wasPressedThisFrame` |
| `Input.getKeyDown(KeyCode.JoystickButton0)` | `Gamepad.current?.buttonSouth.wasPressedThisFrame` — 1 is `buttonEast`, 2 `buttonWest`, 3 `buttonNorth`, 9 `startButton` |
| `Input.getMouseButtonDown(MouseButton.Left)` | `Pointer.current.press.wasPressedThisFrame` — a finger too |
| `Input.mousePosition`, `Input.pointer` | `Pointer.current.position.ReadValue()` (pixels, from the bottom-left) |
| `Input.mouseDelta` | `Pointer.current.delta.ReadValue()` |
| `Input.getButtonDown('Continue')` from a `data-button` | the element's click: every element of the page with `data-button="Continue"` has the class `button-Continue` — `root.Query(className: "button-Continue").ForEach(b => b.RegisterCallback<ClickEvent>(…))` |

`getAxis` eases toward the keys in SceNoCo and Unity's legacy Input; an action does not. Where the
easing matters, ease the value in the behaviour (`Mathf.MoveTowards` at the axis' sensitivity, 3/s).
The first scene has an `Input` object — the UI's EventSystem with its Input System module — kept for
the whole game: UI clicks need it.

## Tweens: DOTween, the free one

SceNoCo's tweens are DOTween's API, and the free DOTween has all of it: every `do…` shortcut core has
(`DOMove`, `DOLocalRotate`, `DOJump`, `DOPunch…`, `DOShake…`, `DOLookAt`, Camera `DOFieldOfView` and
`DOOrthoSize`, Light `DOColor` and `DOIntensity`, Material `DOColor`, `DOFade` and `DOFloat`), sequences,
`DOTween.To`, `DOVirtual`, every setting (`SetEase`, `SetLoops`, `SetDelay`, `SetRelative`, `SetUpdate`,
`SetLink`, `From`), callback and control. DOTween Pro adds what SceNoCo has no counterpart for — visual
Animation and Path components, `DOSpiral`, TextMesh Pro and 2D Toolkit shortcuts — so a port never
needs it. The export does not install DOTween; it says when the game uses tweens.

Install it with the person, from Demigiant only: the [Asset Store](https://assetstore.unity.com/packages/tools/animation/dotween-hotween-v2-27676)
(their account: **Package Manager ▸ My Assets ▸ DOTween ▸ Import**), or the zip from
[dotween.demigiant.com/download](https://dotween.demigiant.com/download) into `Assets/Plugins/` — ask
before downloading. Then **Tools ▸ Demigiant ▸ DOTween Utility Panel ▸ Setup DOTween… ▸ Apply** (again
after every update); for game code in an `.asmdef`, **Create ASMDEF…** there and reference `DOTween.Modules`.

Where a port differs from the TypeScript:
- A colour other than a material's main one is named: `material.DOColor(to, "_EmissionColor", d)`;
  `DOFloat(to, "_Metallic", d)`. URP has no emissive intensity to tween: tween `_EmissionColor` (Materials, above).
- `setUpdate(true)` tweens run on unscaled time, which a Diceload simulation plays with
  `PlayInRealTime`; every other tween runs on the held game clock.

## Code outside behaviours

`Assets/Scripts/Modules` holds the rest, as TypeScript, for you to decide:

- helpers — functions — are a `static class`;
- a union of names (`'title' | 'ready'`) is an `enum`;
- a table of specs a designer tunes — a `Record` of towers, enemies, levels — is a **ScriptableObject**:
  one class per record type (`TowerSpec : ScriptableObject`, a nested object a `[Serializable]`
  class), one `.asset` per entry made by an Editor script run with `unity command script.run`, and a
  serialized field on the behaviour that read the table, holding the assets;
- a constant only one behaviour uses is a serialized field on it;
- `main.ts` set up the renderer: its tone mapping and post-processing are a Volume (below).

## UI

The page came across as it is, rule by rule. What code does with it:

- `getElementById` (or the page's `$`) is `root.Q("id")` on `GetComponent<UIDocument>().rootVisualElement`
  (an object takes one UIDocument: several on one node are on children named after their elements),
  found once in `Awake` or `OnEnable`; `textContent` is `Label.text` (an element code fills is a
  `Label`); `classList.add`, `remove`, `toggle` are `AddToClassList`, `RemoveFromClassList`,
  `EnableInClassList`; `transitionend` is `TransitionEndEvent`; `style.left = '30%'` is
  `style.left = Length.Percent(30)`.
- A `<template>` is `Assets/UI/<id>.uxml`. A behaviour that took one by id (`this.chip = $('chip')`)
  has a `VisualTreeAsset` field of that name, wired to it: `chip.Instantiate()` where the code cloned
  it. Any other gets a field of its own, set in its scene.
- The export says in its warnings what USS has no way to write. Change the page so it ports, and
  export again: the UI is never hand-edited here.

## Sound

- Each scene's main camera has an `AudioListener`, as a new Unity scene's does: the page needs none,
  and Unity plays nothing without one. One listener at a time: a camera added in code has none.
- `AudioContext` nodes are an `AudioSource` and its mixer. Sound the game makes as it plays — an
  `AudioWorklet`, a synth — is `OnAudioFilterRead` on a GameObject of its own with an `AudioSource`
  and no clip: it filters whatever source or listener shares its object, so never the camera's. It
  runs on the audio thread; the game talks to it through a queue (`ConcurrentQueue`), as a worklet's
  port does.

## Look

The project's settings are the export's, set by the first import only (a port keeps its own changes), for a three.js game: Linear colour space, HDR, no MSAA (as
SceNoCo renders), Forward+ (no light limit per object, as three has none), soft shadows, and no
skybox reflections in a scene with no environment. Lights divide by π; fog and ambient light come from
the scene. Cameras draw with no post-processing, as three's default renderer does. What `main.ts` set
up in code is the port's:

- **A `Volume` in a scene came across**: a URP Volume with its profile in `Assets/Materials`, and Post
  Processing on for each camera. Bloom's and depth of field's settings do not carry over by number:
  tune them against the web game.
- **Tone mapping and an `EffectComposer` set up by hand** (`renderer.toneMapping`) are a URP Volume too:
  a profile with Tonemapping (ACES), Color Adjustments (post exposure is log₂ of three's
  `toneMappingExposure`) and Bloom, on a GameObject kept across scenes. A profile made from code needs
  `EditorUtility.SetDirty` before it is saved, or its list of components is lost.

## Checking the port

Play both games through the same scenario and compare. The web game is driven with
`window.__scenoco` (its `help()` says how); this one with a Diceload simulation — a PlayMode test
that loads a scene, presses keys on a held 1/60 s clock, reads the game's state in C# and takes
screenshots. The skill says how to write one and run it (`Tools~/unity-test`).

- **One simulation per phase** of the web game's: start, play, win or lose, restart. Step the same
  number of frames on both sides and the two should read the same values: 1/60 s a frame on both
  clocks, the same fixed step (0.02 s) for physics. Log what you compare (`Debug.Log`), and compare
  values rather than screenshots — positions agree within a physics step.
- **Mirror the scenario's input**: a key pressed in frame N on the web is `Press` in frame N here.
  Positions read here have z negated (the mirror above).
- **When a reading differs, the C# is wrong, not the scene**: the scene came across by the exporter.
  When the scene is wrong, fix the game and export again rather than the text. A twin edited here
  since the last export is kept, and the importer's warning names the new export to merge by hand.
- Unscaled time, screen size and sound in a simulation: the skill's `PlayInRealTime`, `SetResolution`
  and `AudioLevel`.
