# Breakout

Three levels of Breakout, written as SceNoCo documents. It exists to be *built* rather than
admired: everything in it is the ordinary way to do the thing, so where the engine makes that
hard, the awkwardness is visible in the source.

```bash
npm --prefix examples/breakout run dev
```

Drag or use ←/→ (or A/D) to move the paddle, click or press space to launch.

## How it is put together

| | |
| --- | --- |
| `assets/render/neon.render.xml` | the look every level shares: fog, tone curve, bloom |
| `assets/scenes/hud.scene.xml` | the HUD **and the run it reports on** — a scene marked `dontDestroyOnLoad`, so a level load does not touch it |
| `assets/scenes/level-{1,2,3}.scene.xml` | one document per level: the look, the lights, the camera, and where the bricks go |
| `assets/scenes/arena.prefab.xml` | the walls, paddle, ball and floor sensor every level shares |
| `assets/scenes/brick.prefab.xml` | one brick — all three tiers |
| `src/Progress.ts` | score, lives, which level, and the readout showing them |
| `src/GameState.ts` | one level's rules, as a scene service |
| `src/Ball.ts` `src/Paddle.ts` `src/Brick.ts` | one job each |

Four things carry most of the weight, and each is a feature doing exactly what it is for:

- **The HUD is a persistent scene.** `main.ts` loads it additively; `<Scene dontDestroyOnLoad>`
  keeps it. The score outlives the level because the object holding it is never rebuilt — no
  module-scope singleton, nothing copied across the seam. `Engine` draws it over the active
  scene without clearing, so it is composited last whatever the level does.

- **The levels are a list in a document.** `<Progress levels="[level-1.scene.xml,
  level-2.scene.xml, level-3.scene.xml]">`. A scene compiles to a class and `SceneManager.load`
  takes one, so a field declared `SceneType` is filled by a path like any other asset reference.
  It is declared in the HUD, which no level imports, so nothing is circular.

- **One brick prefab, three tiers.** A level says `<Override target="#brick" hits="2" />` and
  nothing else; the prefab names all three materials once and the brick picks the one its
  toughness earns. `<Override target="#ball" speed="18" />` on the shared arena is how level
  three is faster than level one.

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

- **A level with seventy bricks is seventy elements.** One `<Prefab>` per brick, and the tier is
  an `<Override>` child, so a grid is generated rather than written. Something like Tiled's
  layer — a repeated placement with a grid of values — would collapse most of a level document.
- **An `<Override>` cannot be given a name.** The three tiers are `hits="1|2|3"` at every site;
  a named preset (v1 called them variants) would say `tier="hard"` once per brick and keep the
  meaning in the prefab.
- **A UI has no scale rule.** uikit lays out in CSS pixels, so a HUD sized for a desktop window
  is enormous on a phone; the sizes here are a compromise picked by looking at both. A camera
  has `CameraFit`; a `<Canvas>` has no equivalent.
- **Nothing reports a brick that is unreachable.** A level whose grid puts a brick behind a wall
  is a level that can never be cleared, and the first sign is a player waiting for a banner that
  never comes.
