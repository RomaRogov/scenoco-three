# @scenoco-three/editor

A local **visual editor** for [SceNoCo](https://github.com/) scenes and prefabs, with an
**MCP server** so a (multimodal) LLM can open a scene, render frames, drive gameplay, and
read back telemetry — the "eyes and hands" for an agent that authors scenes with
`@scenoco-three/compiler`. Humans and agents share the **same live browser tab**: the MCP
tools drive it over a WebSocket bridge, there's no separate headless render path.

```bash
npm i -D @scenoco-three/editor
```

## CLI

```
scenoco-editor [scene|prefab] [options]     Omit the file to choose from a start-up picker
  --components <dirs>   Comma-separated component dirs (default: "assets")
  --packages <pkgs>     Comma-separated tag packages (default: every @scenoco-three/*
                        dependency in the project's package.json)
  --port <n>            Fixed MCP port — pin it so your MCP client survives restarts
                        (the HTTP editor server always takes a free port and prints its URL)
```

```bash
scenoco-editor                                    # zero-config: file picker, auto-detected packages
scenoco-editor assets/scenes/level.scene.xml --port 55470
#   editor:  http://localhost:HTTP_PORT?file=…    ← opens in your browser
#   mcp:     http://localhost:55470/mcp           ← add to your MCP client (transport: http)
```

It serves the editor app through Vite + `@scenoco-three/vite` (so the open scene compiles
exactly like production), bridges that browser session to an MCP server over a WebSocket, and
watches the scene's source dependencies for **live reload** (with an unsaved-changes conflict
prompt).

## MCP tools

| Tool | Args | Returns |
| --- | --- | --- |
| `open_file` | `path` | Opens a `.scene.xml` / `.prefab.xml` in edit mode. |
| `get_preview` | `camera?`, `lookAt?`, `size?` | A **PNG** of the current view. |
| `playback` | `state` | `play` / `pause` / `stop` — enter play mode (components, systems, physics) / freeze / return to the authored scene. |
| `get_telemetry` | `id` | **JSON** of current property values at a scene `id` — a **node** (its transform + every component on it) or a **component** (its `@property` values + its host node's transform). Nodes and components share one id namespace. |
| `simulate` | `commands: SimStep[]` | Ordered **images + JSON** — the workhorse below. |

### `simulate` — closed-loop driving

One call injects input, steps the sim, and captures — *see a game move, not a static scene*.
Each command is a self-contained verb `{ do, … }`:

```ts
type SimStep =
  | { do: 'play' | 'pause' | 'stop' }
  | { do: 'step'; frames?: number; dt?: number }            // advance `frames` ticks (default 1)
  | { do: 'tap'; key: string }                               // key press + release
  | { do: 'keyDown'; key: string }
  | { do: 'keyUp'; key: string }
  | { do: 'click'; x?: number; y?: number; button?: 'left' | 'right' | 'middle' }
  | { do: 'move'; x?: number; y?: number; dx?: number; dy?: number }
  | { do: 'gamepad'; index?: number; buttons?: boolean[]; axes?: number[] }
  | { do: 'preview'; camera?: string; lookAt?: string }
  | { do: 'telemetry'; id: string };
```

```jsonc
// "press Space, advance 90 frames, read the ball, screenshot" — in one tool call
[ { "do": "play" },
  { "do": "tap", "key": "Space" },
  { "do": "step", "frames": 90 },
  { "do": "telemetry", "id": "ball" },
  { "do": "preview" } ]
```

The result is a `multi` payload: each capture's image/JSON in step order.

## Programmatic API

```ts
import { startEditorServer, startMcpServer } from '@scenoco-three/editor';

const editor = await startEditorServer({ cwd });   // defaults: assets/ roots, packages from package.json
const mcp = await startMcpServer(editor.bridge, { port: 55470 });   // editor.bridge.send(EditorCommand)
console.log(editor.url, mcp.url);
// … later
await mcp.close(); await editor.close();
```

Also exported: `buildMcpServer`, the WebSocket `protocol` types (`EditorCommand`,
`EditorResponse`, `EditorResult`, `WS_PATH`, `commandId`).

## Standalone & dependencies

Build-time / Node-side tool — **not** part of the browser runtime; nothing here ships to
production. It depends on `@scenoco-three/compiler` and `@scenoco-three/vite` (compile +
serve) and the MCP SDK; `@scenoco-three/core`, `three`, and `vite` are **peers** (the editor
renders your scene with the same runtime your app uses). You can run it purely for the **human
browser UI** without ever touching MCP, or wire **only** the MCP server to an agent — the two
share one live session but neither requires the other.

See the [repository](../../README.md), [ARCHITECTURE.md](../../ARCHITECTURE.md), and the
[agentic guide](../../agentic/SCENOCO-AGENTIC-GUIDE.md).

## License

[MIT](./LICENSE)
