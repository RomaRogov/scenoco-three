# Porting a SceNoCo game to this Unity project

`scenoco-unity` wrote the game here as Unity's own assets — prefabs, scenes, meshes, materials,
particle systems, the page as UXML and USS, the input actions, the project's rendering settings — and
the game's code as C# stubs holding its TypeScript. What is left is the code, file by file. This card
is the rules for that. It is rewritten by every export.

## What is here

- `Assets/Prefabs`, `Assets/Scenes`, `Assets/Meshes`, `Assets/Materials`, `Assets/Textures`: built by
  `unity command scenoco.import` (or **SceNoCo ▸ Import**), which lists what did not come across.
  Read every warning it prints.
- `Assets/Scripts/<Behaviour>.cs`: one stub per behaviour. Its wired fields are real C# fields, and the
  prefabs already set them; keep their names. Every other field, and every method, holds its
  TypeScript as comments; so does the code its file holds outside the class. Write the C# in its
  place and delete the comment. A stub compiles as it is, so port one at a time and keep the project
  compiling. Stubs are written once and never overwritten.
- `Assets/Scripts/Modules/*.cs`: every other module of the game — helpers, tables, the entry
  `main.ts` — as its TypeScript in comments. Decide what each becomes (below).
- `Assets/UI`: the page — one `.uxml` per `UIDocument`, one per `<template>`, `Page.uss`, its images
  and its fonts. Rewritten by every export: change the page, not these.
- `Assets/SceNoCo/Input/SceNoCo.inputactions`: the project-wide input actions.
- `Assets/SceNoCo/Driver`: the `scenoco` commands that drive the game in Play mode (below).

## Code

- **Hooks are Unity's messages.** `awake` is `Awake`, `update` is `Update`, `onTriggerEnter` is
  `OnTriggerEnter`; the stub already names them, and `update(dt)`'s `dt` is `Time.deltaTime`. Other
  methods are PascalCase.
- **The world is mirrored on Z.** three.js is right-handed, Unity left-handed; the export negates z.
  Negate z in every vector literal and every z the code computes; a rotation about x or y turns the
  other way. `lookAt`, forward vectors and cameras need the same care. The prefabs are already
  mirrored: only code is left.
- **A node's `position`, `rotation` and `scale` are local**: `transform.localPosition`,
  `localRotation`, `localScale`. `getWorldPosition` is `transform.position`. `eulerAngles` are degrees
  on both sides; three's `rotation` is radians.
- **Behaviours read as Unity's already**: `getComponent<T>` is `GetComponent<T>()`, `instantiate`,
  `destroy`, `Time`, `Mathf`, `Random`, `sendMessage` keep their meaning. A prefab a behaviour
  instantiates is a `GameObject` field set to its prefab asset. `findObjectOfType` is
  `FindFirstObjectByType`, `findObjectsOfType` is `FindObjectsByType<T>()` (before Unity 6.6,
  `FindObjectsByType<T>(FindObjectsSortMode.None)`).
- **Coroutines**: a `*generator` is an `IEnumerator`, `this.startCoroutine(this.x())` is
  `StartCoroutine(X())`, `yield new WaitForSeconds(s)` is the same, `yield null` waits a frame.
- **Events**: an `Event<T>` field is a C# `event Action<T>`; `listen(e, f)` is `e += f`, and its
  removal belongs in `OnDestroy`.
- **Colours are `Color`**, as SceNoCo's are three's `Color`: a field the scenes wire comes across
  typed. A colour written as a string in TypeScript is a bug to fix in the game.
- **Materials**: three's `color`, `emissive` and `metalness` are URP Lit's `_BaseColor`,
  `_EmissionColor` and `_Metallic`, and `node.material` is `GetComponent<Renderer>().material` — a
  copy of its own, as a three material written in an element is. URP has no emissive intensity: the
  importer wrote `_EmissionColor` as the colour's linear value times it. Code that animates a glow
  keeps the colour, as the TSX wrote it, and sets `(color.linear * intensity).gamma`.
- **Physics layers** came across: SceNoCo's layer n is Unity's user layer n + 7, named after the
  game's own constant (`Layer.ball`), set on the objects, and the pairs `ignoreLayerCollision` set are
  in the project's Physics settings. Code that names a layer adds 7.
- **Numbers**: `number` is `float`, or `int` where it counts. Keep the units: SceNoCo's are Unity's.
  A union field the scenes wire stays as its stub types it — `string`, `float` — so the prefabs keep
  their values. **Never change a wired field's type**: Unity drops a value it cannot read, and the
  next scene saved loses it for good. If one must change, run `unity command scenoco.import` before
  saving anything.
- **Particle systems** came across as Unity's own, module by module: `play()`, `stop()` and
  `isPlaying` are the same.

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
| `Input.getButtonDown('Continue')` from a `data-button` | the element's click: `root.Q("banner").RegisterCallback<ClickEvent>(…)` |

`getAxis` eases toward the keys in SceNoCo and Unity's legacy Input; an action does not. Where the
easing matters, ease the value in the behaviour (`Mathf.MoveTowards` at the axis' sensitivity, 3/s).
The first scene has an `Input` object — the UI's EventSystem with its Input System module — kept for
the whole game: UI clicks need it.

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

- `getElementById` (or the page's `$`) is `root.Q("id")` on `GetComponent<UIDocument>().rootVisualElement`,
  found once in `Awake` or `OnEnable`; `textContent` is `Label.text` (an element code fills is a
  `Label`); `classList.add`, `remove`, `toggle` are `AddToClassList`, `RemoveFromClassList`,
  `EnableInClassList`; `transitionend` is `TransitionEndEvent`; `style.left = '30%'` is
  `style.left = Length.Percent(30)`.
- A `<template>` is `Assets/UI/<id>.uxml`: give the behaviour a `VisualTreeAsset` field set to it, and
  `Instantiate()` where the code cloned it.
- The export says in its warnings what USS has no way to write. Change the page so it ports, and
  export again: the UI is never hand-edited here.

## Look

The project's settings are the export's, for a three.js game: Linear colour space, HDR, no MSAA (as
SceNoCo renders), Forward+ (no light limit per object, as three has none), soft shadows, and no
skybox reflections in a scene with no environment. Lights divide by π; fog and ambient light come from
the scene. Cameras draw with no post-processing, as three's default renderer does. What `main.ts` set
up in code is the port's:

- **Tone mapping, exposure and bloom** (`renderer.toneMapping`, an `EffectComposer`) are a URP Volume:
  a profile with Tonemapping (ACES), Color Adjustments (post exposure is log₂ of three's
  `toneMappingExposure`) and Bloom, on a GameObject kept across scenes, and Post Processing switched
  on for each camera. Bloom's settings do not carry over by number: tune it against the web game. A
  profile made from code needs `EditorUtility.SetDirty` before it is saved, or its list of components
  is lost.

## Checking the port

Drive both games through the same scenario and compare. The web game is driven with
`window.__scenoco` (its `help()` says how); this one with the `scenoco` commands, which take the same
verbs. They need Unity's CLI and its Pipeline package (`unity pipeline install`).

```bash
unity command scenoco.help
unity command scenoco.import
unity command scenoco.setup --width 1080 --height 1920   # the web game's window size
unity command scenoco.play
unity command scenoco.ready        # Play mode restarts the command server: repeat until it answers
unity command scenoco.pause
unity command scenoco.press --key Space
unity command scenoco.until --target Game.phase --equals playing
unity command scenoco.read --target Player
unity command capture.game_view -- --save_path Screenshots/after-start.png
```

Step the same number of frames on both sides and the two should read the same values: 1/60 s a
frame on both clocks, the same fixed step (0.02 s) for physics. Compare values — `read --target
Ball.transform.position` here, `__scenoco.eval(...)` there — rather than screenshots: they agree
within a physics step. When a reading differs, the C# is wrong, not the scene: the scene came across
by the exporter. UI timed with `WaitForSecondsRealtime`, and UI Toolkit's transitions, run on real
time on both sides, so they do not line up frame for frame. A wait longer than the CLI's 30 s takes
`--timeout 120` after the verb.
