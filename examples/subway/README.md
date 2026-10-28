# Rail Rush

A Subway Surfers clone — three lanes, jump and roll, trains and barriers, coins, a speed ramp, game
over and restart — written by Claude Sonnet 5.5 in one `claude -p` session from the bench's build
prompt, on a project `npm create @scenoco-three` made: 5 minutes, 18 turns, $0.84 (14 Oct 2026).
It is kept as the model wrote it, so it shows what a model writes on SceNoCo without help, rather
than what a person would tidy it into.

```bash
npm --prefix examples/subway run dev
```

Arrows or WASD (or swipes): change lane, jump, roll. Enter or Space to run.

| | |
| --- | --- |
| `src/scenes/Main.tsx` | the city, the track, the runner, the camera — declared |
| `src/scenes/prefabs.tsx` | trains, barriers, coins, buildings — `prefab(() => …)` |
| `src/Spawner.ts` | spawns ahead of the runner with `instantiate`, removes what is behind |
| `src/Player.ts` `src/Game.ts` | lanes, jumping and rolling; the run, the score and the HTML HUD |
| `src/textures.ts` | canvas textures, made once and named from the scenes |

Collisions are the model's own overlap tests, not a physics engine — what models do for a runner,
and why the cut removed the `collision` package.
