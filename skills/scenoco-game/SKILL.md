---
name: scenoco-game
description: Make or change a browser game with SceNoCo — three.js scenes in TSX (no React) and Unity's behaviours, from the @scenoco-three npm packages. Use when asked to build a 2D or 3D web game with SceNoCo, three.js and Unity-style behaviours, to add a game to a React app, or to test or debug a SceNoCo game in the browser through window.__scenoco.
---

# Making a game with SceNoCo

SceNoCo is three.js scenes written in TSX, plus Unity's behaviours. Write it from what you know of
three.js and Unity; two pages say where SceNoCo differs, and they are all there is to read.

## 1. Read

- **The rules card:** `AGENTS.md` in the project, or `node_modules/@scenoco-three/core/AGENTS.md`.
- **`node_modules/@scenoco-three/core/API.md`:** every exported type and signature, the `.d.ts` in
  one file with comments. Look things up there — `grep -n Prefab node_modules/@scenoco-three/core/API.md`
  — never in `dist/` or the source. Another package's README sits beside it:
  `node_modules/@scenoco-three/<name>/README.md`.

## 2. Start

- **A new game:** `npm create @scenoco-three my-game`. The starter runs; replace its scene and
  behaviours.
- **Inside an existing Vite or React app:** the card's **Starting** says how (`src/game/`,
  `play(Main, { container })`).

## 3. Build

Plan it as a Unity project: nodes, the behaviours on them, prefabs, and one behaviour that owns the
game's state (`GameState.phase`), which every check reads. Then repeat:

1. **Change** scenes (`.tsx`, declarations only) and behaviours (`.ts`).
2. **`npm run check`** — fix each error at its line. A scene error gives the exact text to write;
   write it. No `any`, casts or `@ts-ignore`.
3. **Test the rules** in Vitest with `simulate(Main)` (the card's **Checking it**): one test per rule,
   no browser. This is Unity's play-mode test.
4. **Look at it running** (below), and read the console.

Done is a passing test for every rule, a played-through round — start, win or lose, restart — whose
screenshots look right, and a console with no errors.

## 4. Look at it running

`npm run dev`. In development the page has `window.__scenoco`: the Unity editor's Play / Pause / Step
buttons, plus input and readings. `__scenoco.help()` lists the calls.

- **Hold the clock, then step it.** `press`, `step`, `until` and `watch` pause the game on an exact
  frame and keep it there, so a screenshot shows that frame on any machine. Never wait in real time
  for the game to move: on a slow or software renderer a second of waiting is a few frames. `until`
  stops on the frame its condition turned true, before behaviours that ran earlier in that frame
  saw the change: `step(1)` before reading the HUD or taking the screenshot.
- **With any tool that evaluates JavaScript in the page** — a browser tool, or a Playwright or
  Puppeteer script of your own:

  ```js
  await __scenoco.ready();                          // until the first frames, input goes nowhere
  await __scenoco.press('Space');                   // or press('d', 60): held for 60 frames
  await __scenoco.until("GameState.phase === 'playing'", 600);   // { met, frames }
  // now take the screenshot
  ```

  `outline()` prints the scene with every behaviour's fields. `watch(['Ball.speed'], 120, 10)` gives
  values over time, and `eval('return findAll(Coin).length')` any reading. `click(x, y)` and `swipe`
  take window pixels. `view({ cameraPos, lookAt })` looks from elsewhere until `view(null)`, and
  `play()` runs in real time again: page CSS and timers always do.
- **With a tool that can only open an address and take screenshots**, put the same calls in the
  address: `/?drive=press('Space');until(GameState.phase == 'playing');outline()`. Each call logs a
  `[scenoco]` console line, and the last, `done, held at frame N`, means the screenshot is ready
  (`#` is `%23`). Drive reads data and calls nothing else, so a check it can't express goes into the
  game: a getter (`get bricksLeft()`), or a start the game reads itself (`/?level=3&drive=…`).
- **The console:** a behaviour that throws is logged once and the game goes on, so a game that looks
  right can still be broken. Log each state change with `console.info` (`phase: playing`).

## When stuck

- **Blank screen:** the scene has no camera, or it looks away. `outline()`, then `view(...)`.
- **A position is off:** `node.position` is the parent's space; use `getWorldPosition(v)`.
- **Tuning by eye:** `watch` the numbers on a held clock instead.
