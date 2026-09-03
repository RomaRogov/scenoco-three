# Breakout

Three levels of Breakout, written as SceNoCo documents. It exists to be *built* rather than
admired: everything in it is the ordinary way to do the thing, so where the engine makes that
hard, the awkwardness is visible in the source.

![Breakout: a neon brick field, the paddle and ball glowing under bloom](screenshot.png)

```bash
npm --prefix examples/breakout run dev
```

Drag or use ←/→ (or A/D) to move the paddle, click or press space to launch.

## How it is put together

| | |
| --- | --- |
| `assets/render/neon.render.xml` | the look every level shares: fog, tone curve, bloom |
| `assets/scenes/hud.scene.xml` | the HUD **and the run it reports on** — a scene marked `dontDestroyOnLoad`, so a level load does not touch it |
| `assets/scenes/level-{1,2,3}.scene.xml` | one document per level: the look, the lights, the camera, and the wall's map |
| `assets/scenes/arena.prefab.xml` | the walls, paddle, ball and floor sensor every level shares |
| `assets/scenes/brick.prefab.xml` | one brick — all three tiers |
| `src/Progress.ts` | score, lives, which level, and the readout showing them |
| `src/GameState.ts` | one level's rules, as a scene service |
| `src/BrickField.ts` | reads a level's map and places the wall |
| `src/Ball.ts` `src/Paddle.ts` `src/Brick.ts` | one job each |

A few things carry most of the weight, and each is a feature doing exactly what it is for:

- **The HUD is a persistent scene.** `main.ts` loads it additively; `<Scene dontDestroyOnLoad>`
  keeps it. The score outlives the level because the object holding it is never rebuilt — no
  module-scope singleton, nothing copied across the seam. `Engine` draws it over the active
  scene without clearing, so it is composited last whatever the level does.

- **The levels are a list in a document.** `<Progress levels="[level-1.scene.xml,
  level-2.scene.xml, level-3.scene.xml]">`. A scene compiles to a class and `SceneManager.load`
  takes one, so a field declared `SceneType` is filled by a path like any other asset reference.
  It is declared in the HUD, which no level imports, so nothing is circular.

- **One brick prefab, three tiers.** A level says `hits="2"` — through an `<Override
  target="#brick">` on a lone spawn, or a `2` in a wall's map — and nothing else; the prefab
  names all three materials once and the brick picks the one its toughness earns. `<Override
  target="#ball" speed="18" />` on the shared arena is how level three is faster than level one.

- **A wall is data and a loop.** `<BrickField brick="brick.prefab.xml" rows="[.22222.,
  2111112, …]" />`. The map used to sit above each level as a comment while thirty near-identical
  `<Prefab>` elements repeated it below; the comment was always the readable version, so it is
  the data now. What makes that possible is that a prefab is nameable — a field declared
  `PrefabType` is filled by a path, exactly as a geometry or a material is — so the thing being
  repeated is still authored in the document and the loop lives where loops live.

- **The camera states a frame, not a fov.** `<CameraFit mode="contain" width="21" height="19.5">`,
  so a phone in portrait letterboxes instead of cropping the side walls.

- **The look is one file.** `<Scene render="../render/neon.render.xml">` in all three levels;
  the fog, the tone curve and the bloom are written once. Each is on because its element is
  there, so turning the bloom off is deleting a line.

Bricks register themselves with `GameState` in `awake`, the way a `RigidBody2D` joins the physics
world, so nothing queries the scene and no list of bricks is wired up by hand. `GameState` finds
the persistent `Progress` in `start()` — the phase after the whole document is built — with
`SceneManager.findObjectOfType`, which searches every loaded scene, as Unity's does.

## What the engine still makes awkward

Kept as written rather than tidied away, because each one is a gap worth closing:

- **An `<Override>` cannot be given a name.** The three tiers are `hits="1|2|3"` at every site;
  a named preset (v1 called them variants) would say `tier="hard"` once per brick and keep the
  meaning in the prefab.
- **A UI has no scale rule.** uikit lays out in CSS pixels, so a HUD sized for a desktop window
  is enormous on a phone; the sizes here are a compromise picked by looking at both. A camera
  has `CameraFit`; a `<Canvas>` has no equivalent.
- **Nothing reports a brick that is unreachable.** A level whose grid puts a brick behind a wall
  is a level that can never be cleared, and the first sign is a player waiting for a banner that
  never comes.
