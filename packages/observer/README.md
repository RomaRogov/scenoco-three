# @scenoco-three/observer

**An agent's eyes on a SceNoCo scene, as an MCP server.** Layer 3 of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```bash
claude mcp add scenoco -- npx -y @scenoco-three/observer
```

That is the whole setup. It speaks MCP on **stdio**: the client starts it in the project, talks
to it on stdin/stdout, and ends it with the session. On the first tool call it compiles the
project, launches **Chrome headless**, opens the scene in it, and from then on answers from that
page — what is there (`outline`), what it looks like from a stated viewpoint (`screenshot`), what
a thing's state is (`telemetry`), and what happens when it is driven (`simulate`). Nothing
appears on screen; `--headed` shows the window for whoever wants to watch.

Headless Chrome renders through the same GPU stack as a window (an M-series Mac reports
"ANGLE Metal Renderer" from it), so what the agent sees is what a person would see. There is no
software-rendered fallback pretending to be a picture.

## Tools

| Tool | Args | Returns |
| --- | --- | --- |
| `open` | `path` | Opens a `.scene.xml` / `.prefab.xml`. Everything else needs one open. |
| `outline` | `id?`, `depth?` | **Text.** Every node with its id, class, world position and components with their values, indented by depth; then the systems and their values. The cheapest and most exact view there is. |
| `screenshot` | `cameraPos`, `lookAt?`, `fov?`, `width?`, `height?`, `ui?` | A **PNG** from that viewpoint. |
| `telemetry` | `id` | **JSON** at an id: a node's transform, visibility and each component's fields and getters, or a component's alone. |
| `play` / `pause` / `stop` | — | Run the scene / hold it / reload the document, release every key, reset the clock. |
| `simulate` | `steps`, `width?`, `height?`, `ui?` | Ordered **text + images + JSON**, one entry per capturing step. |

A point — `cameraPos`, `lookAt` — is written in the document's own vector grammar,
`"y: 6; z: 12"`, an omitted axis being 0; or as an **anchor**, `"#player"` (that node's world
position) or `"#player y: 6; z: 8"` (plus an offset). `fov` is the vertical field of view in
degrees, smaller being more zoomed in. Nothing else about a capture is derived from the scene.

Values come back in the vocabulary the XML is written in: eulers in **degrees**, colours as
`"#rrggbb"`. An id is the document's, or the one `instantiate` was given, with `/` for what a
prefab named inside: `slime3/body`.

When a document or a component changes on disk, the next tool call reopens the scene from the
rebuilt module — or reports why it no longer compiles.

### `simulate` — drive it, then look

```ts
type SimStep =
  | { do: 'play' | 'pause' | 'stop' }
  | { do: 'step'; frames?: number; dt?: number }              // advance exact ticks (default 1)
  | { do: 'press' | 'keyDown' | 'keyUp'; key: string }        // a KeyCode name: "W", "Space"
  | { do: 'click'; x?: number; y?: number; button?: 'left' | 'right' | 'middle' }
  | { do: 'move'; x?: number; y?: number; dx?: number; dy?: number }
  | { do: 'preview'; cameraPos: string; lookAt?: string; fov?: number }
  | { do: 'telemetry'; id: string }
  | { do: 'outline'; id?: string; depth?: number }
  | { do: 'eval'; code: string };                              // JavaScript against the live scene
```

**`pause` then `step` is deterministic** — the scene advances by exactly the frames asked for,
so numbers read back are reproducible. `play` runs in real time, the way a player sees it.

**`eval`** runs its code as the body of an async function with `scene`, `byId(path)`,
`find(TypeName)` / `findAll(TypeName)` (components, by class name), `system(TypeName)`, `Time`,
`Input`, `SceneManager` and `THREE` in scope, and returns whatever it `return`s. It is how an
agent *sets up* the situation it wants to check instead of hunting for it, and it is the one
thing here with hands: they reach the running scene only, never a file, and `stop` discards
everything they did.

```jsonc
{ "steps": [ { "do": "stop" }, { "do": "pause" }, { "do": "step", "frames": 2 },
             { "do": "eval", "code": "find('Slime').object3D.position.set(0, 0.5, -4)" },
             { "do": "press", "key": "Space" },
             { "do": "step", "frames": 20 },
             { "do": "eval", "code": "return system('GameState').score" },
             { "do": "outline" } ] }
```

## CLI

```
scenoco-observer [options]
  --root <dir>       Project root (default: the nearest one at or above the current directory)
  --modules a,b      Tag packages beyond three (default: the project's own dependencies)
  --headed           Show the browser window
  --browser <path>   A browser executable, when Chrome is not installed where the OS keeps it
  --http <port>      Serve the MCP over HTTP on a fixed port instead of stdio
```

It needs Google Chrome (or Edge, or any Chromium, by `--browser`). Nothing is downloaded.

## What is deliberately absent

No tool writes to your source. An agent already has file tools, and the observer rebuilds
whatever they write, so an edit tool would be a second write path into your project that never
passed through your own editing, your diff or your undo. Change the XML; the observer shows the result.

## License

MIT
