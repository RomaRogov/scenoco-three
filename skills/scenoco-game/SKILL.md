---
name: scenoco-game
description: Make or change a browser game with SceNoCo — three.js scenes in TSX (no React) and Unity's behaviours, from the @scenoco-three npm packages. Use when asked to build a 2D or 3D web game with SceNoCo, three.js and Unity-style behaviours, to add a game to a React app, or to test or debug a SceNoCo game in the browser through window.__scenoco.
---

# Making a game with SceNoCo

SceNoCo is three.js plus Unity's model: a scene is a `.tsx` file that only declares three.js
objects, and logic lives in `Behaviour` classes with Unity's lifecycle. Write it from what you know
of three.js and Unity; the rules card says where SceNoCo differs.

## 1. Read the two pages first

- `AGENTS.md` — the rules card: scenes, behaviours, refs, prefabs, assets, physics, input, packages.
  In a project made by `npm create @scenoco-three` it is the project's own `AGENTS.md`; otherwise
  `node_modules/@scenoco-three/core/AGENTS.md`.
- `node_modules/@scenoco-three/core/API.md` — every signature. Read it instead of the package's
  source. A package's own README is in `node_modules/@scenoco-three/<name>/`.

Don't write anything SceNoCo-specific before reading both.

## 2. Start

- **A new game:** `npm create @scenoco-three my-game`, then `npm install`. The starter runs: steer a
  block, drop crates. Replace its scene and behaviours rather than starting from an empty folder.
- **Inside a React app:** game files go in `src/game/`. In `vite.config.ts`:
  `react({ exclude: /src\/game\// })` beside `scenoco({ include: 'src/game/**' })`, with `scenoco`
  from `@scenoco-three/tools/vite`. A component runs `play(Main, { container })` in an effect and
  `game.dispose()` in its cleanup. Only one game at a time.
- **Physics, particles, audio, splines, terrain** are separate packages
  (`@scenoco-three/rapier`, `box2d`, `particles`, `audio`, `splines`, `terrain`). Install one before
  writing your own. With rapier, `main.ts` starts with `await initRapier();`.

## 3. Write it

- **Plan in Unity terms first:** which nodes, which behaviours on them, which prefabs get
  instantiated, which state lives where. Keep one behaviour that owns the game state (e.g.
  `GameState` with a `phase` field) — it is what you will test against.
- **Scenes and prefabs** (`src/scenes/*.tsx`) only declare. No hooks, loops, conditions or
  handlers in them. Anything that changes over time is a behaviour in a `.ts` file.
- **Levels are built in the editor, so write them as placed elements.** Levels, puzzles, waves and
  pickups are one element per object (`<Brick position={[2.55, -1, 0]} hits={2} />`), never string
  maps or loops: the user drags them in the editor and the file keeps what they did. Add placing help
  as a behaviour, for example a grid snap in `onValidate` with a `snap` flag to turn it off.
  `examples/breakout` (`GridSnap`) shows one.
- **Every scene needs its own camera and lights.** A scene without a camera draws nothing.
- **UI is HTML and CSS** in `index.html`, read and written with the DOM.
  `<button data-button="Jump">Jump</button>` reads as `Input.getButtonDown('Jump')`. Give every
  control a labelled button beside its key: phones need it, and so do browser tools that can click a
  button but not the canvas.
- **Log each change of game state** with `console.info` — `phase: playing`, `score: 3`, `lives: 2`.
  The console is the one thing every agent's browser tool can read.
- **Rotations are radians in three.js; 2D physics angles are degrees**, as in Unity. three.js is
  right-handed and a camera looks down its own -z.
- **Time:** `destroy()` happens at the end of the frame. Use coroutines (`WaitForSeconds`) or
  `update(dt)` for timing, not `setTimeout`/`Date.now`, which don't pause with `Time.timeScale = 0`.

## 4. Check it

Run `npm run check` (`tsc --noEmit && scenoco check src`) after every change, and fix every error
at the line it names. A scene error comes with the exact text to write instead; write that. Don't
silence an error with `any`, a cast or `// @ts-ignore`: a wrong attribute name is a real bug.

## 5. Look at it running

`npm run dev` serves the game (Vite, usually `http://localhost:5173`). In development the page has
`window.__scenoco`, which drives the game. Call it with any browser tool that evaluates JavaScript in
the page; `__scenoco.help()` lists everything. Start with `await __scenoco.ready()`: until the game
has run its first frames, a key press goes nowhere.

**If your browser tool can't run JavaScript in the page** (it can only open addresses, click, read
the console and take screenshots), drive the game from the address to the moment you need to see:

```
/?drive=press('Space');until(GameState.phase == 'playing');read(count(Brick));outline()
```

The calls run in order on a held clock. Each answer is one console line starting `[scenoco]`, and the
last line is `done, held at frame N`. Take the screenshot after that line: it shows exactly that
frame. Write `#` as `%23` in the address.

**What drive can read.** It reads data, not code. It can read:
- behaviours' fields and getters (`GameState.phase`, the first live one's), and `#node.position.x`;
- `Time`, `scene` and `camera`;
- `count(T)`, `find(T)` and `findAll(T)`;
- literals and operators.

It can't call methods or anything else. When a check needs more, add a point to the game for drive
to address, rather than working around it:
- **A reading:** a getter on the behaviour that owns it, such as
  `get bricksLeft() { return findObjectsOfType(Brick).length }`.
- **A starting point:** let the game start where the check begins. Read a parameter in `main.ts`, such
  as `/?level=3&drive=…`, or add a scene for that situation.

- **Hold the clock, then step it.** `until`, `step`, `press` and `watch` hold the game clock, so
  every reading lands on an exact frame and nothing runs while you think. `play()` lets it run in
  real time again.
- **Prove the rules, not just the picture:**

  ```js
  async () => {
    await __scenoco.press('Space');
    return __scenoco.until("GameState.phase === 'playing'", 300);   // { met, frames, time }
  }
  ```

  In code passed to `until`, `watch` and `eval`, `Player.lane` is the first live `Player`'s field
  and `#paddle` is the node named "paddle". `find`, `findAll`, `node`, `scene`, `camera`, `Time`,
  `Input` and `THREE` are in scope.
- **Common calls:**
  - `outline()` — the scene as text, with every behaviour's fields. Check it before you go hunting.
  - `watch(["Ball.speed", "Time.time"], 120, 10)` — values over time.
  - `eval("return findAll(Coin).length")` — any reading.
- **Input as the player's:**
  - keys: `press('ArrowLeft', 20)`, `keyDown`/`keyUp`
  - pointer: `click(x, y)`, `swipe([x1, y1], [x2, y2])`, with `x, y` in pixels from the window's
    top-left.
- **Screenshots:** step the clock, then take the screenshot with the browser tool's own command.
  `view({ cameraPos: [0, 20, 0], lookAt: [0, 0, 0] })` draws from another viewpoint until `view(null)`.
- **The held clock doesn't drive the page:** CSS animations and page timers run in real time. To see
  one finish, `play()` and wait.
- **Read the console** after loading and after each scenario. A behaviour that throws is logged
  there once, as `Player.update on "runner" threw`, and the rest of the game keeps running. So a
  game that looks fine can still have a broken behaviour: check the console.

The loop is: change → `npm run check` → reload → drive with `__scenoco` → screenshot → fix. A game is
done when a played-through scenario reaches each phase (start, win or lose, restart) and the
screenshots look right. "It compiles" isn't done.

## 6. Test the rules

Every rule the game has gets a Vitest test, in Node or jsdom, with no browser and no canvas:

```ts
import { simulate, findObjectOfType, KeyCode } from '@scenoco-three/core';
import { Main } from '../scenes/Main';

it('Space starts the round, and the ball breaks a brick', () => {
  const game = simulate(Main);
  const state = findObjectOfType(GameState)!;
  game.press(KeyCode.Space);
  expect(state.phase).toBe('playing');
  expect(game.until(() => state.score > 0, 1200)).toBe(true);
  game.dispose();
});
```

- **What `simulate` does:** it builds the scene exactly as `play` does and runs nothing until the test
  steps it.
- **The calls:** `step(frames)`, `until(condition, maxFrames)`, `press(key)` and `keyDown`/`keyUp`.
  Frames have a fixed `dt`, so a test gives the same answer every run. Always `dispose()` at the end.
- **Limits:** nothing is drawn, so looks still need the browser (step 5). Rapier needs
  `await initRapier()` first. Audio and texture loading need the browser.

For a Playwright or Puppeteer test against the running dev server, `@scenoco-three/observer` is the
same bridge as `__scenoco`.

## Mistakes that cost the most time

- **A blank screen:** the scene has no camera, or the camera points away. Read `outline()`, then
  move the camera with `view(...)`.
- **Logic in a `.tsx` scene:** `scenoco check` refuses it. Move it into a behaviour.
- **Positions:** `this.node.position` is local to the parent. Use `getWorldPosition(v)` for the
  world position.
- **Behaviours finding each other:** use `getComponent(T)`, `findObjectOfType(T)` or a `ref` set in
  the scene, never by name. An empty `class Enemy extends Behaviour {}` is a Unity tag.
- **Tuning by eye in real time:** use a held clock and `watch` instead. The numbers say whether a
  jump reaches the platform.
