// `@scenoco-three/editor` — programmatic API behind the `scenoco-editor` CLI.
// Serves the editor app, bridges it to an MCP server over a WebSocket, and exposes
// MCP tools (open_file / get_preview / run / pause / stop / get_telemetry).
export { startEditorServer, type ServerOptions, type EditorServer, type EditorBridge } from './server.js';
export { startMcpServer, buildMcpServer, type McpHandle } from './mcp.js';
export {
  WS_PATH,
  commandId,
  type EditorCommand,
  type EditorResponse,
  type EditorResult,
} from './protocol.js';
