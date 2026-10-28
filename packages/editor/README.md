# @scenoco-three/editor

A visual editor for SceNoCo scenes that is never part of the project. Part of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```bash
npm run dev                  # the game's own dev server, as always
```

Then press **Edit** on the bar along the game's top, beside its frame rate; **Hide** puts the bar away
until the page loads again, and the game is laid out under the bar, so it covers nothing. The bar is
there only in development: the project's `scenoco()` Vite plugin serves this package's one module,
and a production build never contains it.

- **Over the running game.** Pause it, step one frame, or reset — the page loads again and holds
  after its first frame, the editor open. What behaviours run before the hold is a setting (⚙):
  `awake`, `onEnable`, `start`, one frame, or none of them, to see the scene just as the files
  build it; play or step from there and they catch up. Paused, the view is the
  editor's own: orbit around, or fly as in Unity — hold the right button to look, W A S D to move,
  Q and E down and up, Shift faster, the wheel for speed, the arrows without the button — tap a
  node to select it, move, rotate or scale it with the gizmo,
  over a ground grid. The page's HTML — its HUD — is hidden while the editor is open, so the 3D
  can be edited without it in the way; a switch shows it again.
- **Any scene, as Unity's open scene.** The Scene list under the toolbar has every exported
  `<Scene>` of the project; picking one loads the page again in it, held as a reset holds it, and
  every reset after starts there too. "As the game starts" — or closing the editor — goes back to
  the game's own first scene.
- **Beside the game, not over it.** A column on the right, or the lower half of a phone held
  upright; the game lays itself out in the rest, or, above the panel, is scaled into it whole —
  playing, in its own shape, so a game that frames itself by its screen frames itself as it will be
  played; paused, widened to fill the space, for the editor's own camera.
  Drag the panel's inner edge to resize it; the browser remembers the width and the height.
- **The selection as its TSX.** The tag that made it — `<Keep position={[0, 0.9, 26.8]} />` — and
  the behaviours on it, each value live and editable in place: numbers, vectors, rotations in
  degrees, colours, flags, strings, and one-of-a-few values as a list — `alignTo="world"`, three's
  `side={DoubleSide}` (imported for you when the file lacks it). What each field is comes from its
  declared type, as the project's TypeScript (7 or later) reads it; `private` fields are not shown.
  A behaviour lists every public field, those the file leaves out greyed at their defaults; a
  three.js tag lists what the file writes, besides a node's name and transform.
  Drag a number sideways to scrub it. A value with focus
  shows what the file says; a value changed and not saved, or moved by the game, has a reset
  button at the end of its line that puts back what the file says — or, for one the file does not
  write, the value before the change. Focusing position, rotation or scale picks the gizmo's mode.
  Everything else — `material={paint.wall}`, a ref — is shown as written, each name in it a link
  to where it is declared: `terrains` and `meadow` in `{terrains.meadow}` are two links, found by the
  project's own TypeScript (7 or later) through its imports.
- **Constructor arguments too.** `args={[…]}` shows one line per argument, named for the
  constructor's parameter — `skyColor`, `groundColor`, `intensity` — and what an element's children
  made, such as `<PlaneGeometry>`, shows under its node. An argument changes the live object
  through the property it sets, found by building the class with it changed; a geometry or a
  material is built again and copied into itself. Save rewrites only the item that changed.
- **A behaviour sees its fields change.** After a field is changed in the editor — or undone, or
  reset — its `onValidate()` runs, as Unity's `OnValidate` does; so it does when its node moves, or
  a node a scene gave it, or one under that. What a behaviour builds once in `start` follows a
  change when `onValidate` builds it again: `onValidate() { this.place(); }` slides a `PlaceOnPath`
  along its path as `t` is dragged, and a road bent along a spline follows a knot under the gizmo.
- **Your code editor, your way** (⚙, the same settings). Source links open the editor that is running, or
  `$LAUNCH_EDITOR`; the system's app for `.tsx`; VS Code or Cursor through their own links; or the
  project's command, set where nothing but the project can set it —
  `scenoco({ editor: 'zed {file}:{line}:{col}' })` in `vite.config`, or `SCENOCO_EDITOR`. When a
  link cannot open, the status line says why.
- **Nothing is written until Save.** A change shows in the game at once and is marked unsaved;
  **Save** (⌘S / Ctrl+S) writes every one, and leaving the page with some unsaved asks first.
- **What a scene file wrote is written back, and nothing else is.** One attribute of the element it
  came from, spliced into the `.tsx` file; comments, layout and every other attribute stay byte
  for byte. What was spawned while the game ran, and what code made, are changed live only, and
  say so.
- **Prefabs, as in Unity.** A copy shows two layers: its tag — this copy's overrides, its props and
  its placement, written into the scene — and under it the prefab's own, read-only. **Edit
  prefab** enters prefab mode, in context: what the prefab is made of becomes editable, written
  into the prefab's file, and every copy in the scene takes each change as it is made. The bar on
  top says which prefab, which file and how many copies; ← goes back, and Isolate shows only the
  prefab.
- **Undo and redo** (⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y) move the live values and what is unsaved; undoing
  a saved change leaves it unsaved, and saving that puts the file's text back exactly as it was —
  `-Math.PI / 2` too. A file edited elsewhere since is refused, never written at the wrong element.

What it does not do yet: add or remove elements.
