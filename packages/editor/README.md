# @scenoco-three/editor

A local **visual editor + headless renderer** for [SceNoCo](https://github.com/) scenes and
prefabs, with an **MCP server** so a (multimodal) LLM can open a scene, render frames, drive
gameplay, and read back telemetry — the "eyes and hands" for an agent that authors scenes
with `@scenoco-three/compiler`. Humans get a browser editor; agents get MCP tools, over **one
shared live session**.

```bash
npm i -D @scenoco-three/editor
```

## CLI

```
scenoco-editor <scene|prefab> [options]
  --components <dirs>   Comma-separated component dirs (default: "src")
  --packages <pkgs>     Comma-separated tag packages (e.g. @scenoco-three/box2d)
  --port <n>            Fixed editor server port (default: a free port)
  --no-open             Don't auto-open a browser
```

```bash
scenoco-editor scenes/level.scene.xml --components src --packages @scenoco-three/box2d
#   editor:  http://localhost:PORT?file=…   ← opens in your browser
#   mcp:     http://localhost:PORT/mcp      ← add to your MCP client (transport: http)
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
| `get_telemetry` | `id` | **JSON** of current property values for the node + components at a scene `id`. |
| `simulate` | `commands: SimStep[]` | Ordered **images + JSON** — the workhorse below. |

### `simulate` — closed-loop driving

One call injects input, steps the sim, and captures — *see a game move, not a static scene*.
Each command is `{ do, … }`:

```ts
type SimStep =
  | { do: 'play' | 'pause' | 'stop' }
  | { do: 'step'; frames?: number; dt?: number }
  | { do: 'key'; code: string; action: 'down' | 'up' | 'tap' }
  | { do: 'mouse'; x?: number; y?: number; dx?: number; dy?: number;
      button?: 'left' | 'right' | 'middle'; action?: 'move' | 'down' | 'up' | 'click' }
  | { do: 'gamepad'; index?: number; buttons?: boolean[]; axes?: number[] }
  | { do: 'preview'; camera?: string; lookAt?: string }
  | { do: 'telemetry'; id: string };
```

```jsonc
// "press Space, advance 90 frames, read the ball, screenshot" — in one tool call
[ { "do": "play" },
  { "do": "key", "code": "Space", "action": "tap" },
  { "do": "step", "frames": 90 },
  { "do": "telemetry", "id": "ball" },
  { "do": "preview" } ]
```

The result is a `multi` payload: each capture's image/JSON in step order.

## Programmatic API

```ts
import { startEditorServer, startMcpServer } from '@scenoco-three/editor';

const editor = await startEditorServer({ cwd, componentRoots: ['src'], packages: [] });
const mcp = await startMcpServer(editor.bridge);   // editor.bridge.send(EditorCommand)
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
