# @scenoco-three/observer

**An agent's eyes on a SceNoCo game, as an MCP server.** Part of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```bash
claude mcp add scenoco -- npx -y @scenoco-three/observer
```

It speaks MCP on **stdio**: the client starts it in the project, and it ends with the session. On
the first tool call it starts the project's **own Vite dev server** and a **headless Chrome** on the
GPU (`--headed` shows the window), opens the game, and answers through the bridge `play()` installs
in development. Nothing in the game has to expose anything.

- `screenshot` — exactly what the player sees, HTML HUD included; or from another viewpoint.
- `simulate` — ordered steps: `pause` holds the game clock, `step` / `until` advance exact frames
  (`until: "GameState.phase === 'playing'"`), `watch` tabulates expressions over frames, `press`,
  `click`, `swipe` drive input, `telemetry` / `outline` / `eval` read state. `Player.lane` is the
  first live `Player`'s field; `#paddle` is the node named "paddle".
- `outline`, `telemetry` — every behaviour's fields, by class.

A page without SceNoCo still gets screenshots, input and `eval`.
