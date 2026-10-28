# Breakout

Three levels of Breakout on SceNoCo: scenes in TSX, behaviours in TypeScript, the HUD in HTML. It
exists to be *built* rather than admired: everything in it is the ordinary way to do the thing, so
where the engine makes that hard, the awkwardness is visible in the source.

![Breakout: a neon brick field, the paddle and ball glowing under bloom](screenshot.png)

```bash
npm --prefix examples/breakout run dev
```

Drag or use ←/→ (or A/D) to move the paddle, click or press space to launch.

## How it is put together

| | |
| --- | --- |
| `src/main.ts` | `play(Run)`, and the look: three's tone mapping and `EffectComposer` bloom |
| `index.html` | the HUD — score, level, lives, and the banner between rounds |
| `src/scenes/Run.tsx` | the run: `Progress` and the list of levels, kept across every level load |
| `src/scenes/levels.tsx` | one `Level` scene function, and three levels that differ in four values |
| `src/scenes/Arena.tsx` | the walls, paddle, ball and floor sensor every level shares, and the brick prefab |
| `src/assets.ts` | the geometries and materials several nodes share, made once |
| `src/Progress.ts` | score, lives, which level, and writing them into the HUD |
| `src/GameState.ts` | one level's rules, on the level's scene |
| `src/BrickField.ts` | reads a level's map and spawns the wall |
| `src/Ball.ts` `src/Paddle.ts` `src/Brick.ts` `src/CameraFit.ts` | one job each |

A few things carry most of the weight:

- **The run outlives the level.** `play(Run)` loads the run first; `Progress` calls
  `dontDestroyOnLoad(this)` in `awake` and then `SceneManager.load(Level1)`. A level load
  destroys the level before it and leaves the run alone, so the score is never copied anywhere.
- **The HUD is the page.** `Progress` writes `textContent` into `index.html`'s elements. The banner
  between rounds is `<div data-button="Continue">`: a tap on it is `Input.getButtonDown('Continue')`
  on the next frame, sampled like a key rather than handled between frames.
- **A level is a scene function with props.** `<Level title="FORTRESS" ballSpeed={16} rows={…} />`;
  the arena is a plain component, and `<Arena ballSpeed={ballSpeed} />` is how level three is
  faster than level one.
- **A wall is data and a loop.** `<BrickField rows={['.22222.', '2111112', …]} />`: a scene only
  declares, so repetition is a behaviour's job. `BrickField` spawns `BrickPrefab` and sets
  `Brick.hits` right after `instantiate`; the brick reads it in `start` and picks its tier's shared
  material.
- **The camera states a frame, not a fov.** `<CameraFit width={21} height={19.5} />`, so a phone in
  portrait letterboxes instead of cropping the side walls.

Bricks register with `GameState` in `awake` (found with `findObjectOfType`), so nothing queries the
scene and no list of bricks is wired by hand. `GameState` finds the kept `Progress` the same way.

## What the engine still makes awkward

- **A prefab cannot be a behaviour's field.** A field typed as a function is not a setting, so
  `BrickField` imports `BrickPrefab` rather than being handed it in the scene.
- **Nothing reports a brick that is unreachable.** A level whose map puts a brick behind a wall can
  never be cleared, and the first sign is a player waiting for a banner that never comes.
