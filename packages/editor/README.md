# @scenoco-three/editor

A visual editor for SceNoCo scenes that is never part of the project. Part of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```bash
npm run dev                  # the game's own dev server, as always
npx scenoco-editor           # the editor's interface, on http://localhost:5185
```

Then open the game with `?edit` — `http://localhost:5173/?edit` — or any scene or prefab function
with `?edit&scene=/src/scenes/levels.tsx%23Level2`.

- **The game builds the scene.** In development, `play()` sees `?edit`, builds the scene with the
  game's own code on the game's own server, and holds it still: no behaviour wakes. Then it loads
  this package's interface from its URL (`?edit=<url>` to load it from elsewhere).
- **What you see is live.** A tree of the scene, an inspector — transform, the element's own
  attributes, the geometry's and material's, every behaviour's fields — and a move / rotate / scale
  gizmo, with Global or Local handles. A change is applied to the live object the way the scene sets it.
- **Made for a finger as much as a mouse.** On a phone held upright the node list and the inspector
  are bottom sheets, one at a time; turned sideways, or on a screen, they are side columns that can
  both be open. Drag the letter beside a number to scrub it: the scene follows the drag, and the
  file is written once, when it ends.
- **What you change is written back, and nothing else is.** The project's `scenoco()` Vite plugin
  writes one attribute into the `.tsx` file the element came from, splicing its text; comments,
  layout and every other attribute stay byte for byte. A value it cannot see through — a
  `material={paint.wall}`, a ref — is shown, not edited. Rotations show in degrees and are written
  in radians; numbers are rounded to four decimals.

- **Undo puts the text back.** ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y restore an attribute exactly as it
  was written — `-Math.PI / 2` too — and survive the reload that removing an attribute needs.
- **A file changed behind its back is refused.** Every write names the element it means as the
  editor last read it; if the file was edited elsewhere since, nothing is written and the editor
  says to reload.

What it does not do yet: add or remove elements, or show what behaviours spawn at runtime
(nothing runs while editing — `BrickField`'s bricks are not there).
