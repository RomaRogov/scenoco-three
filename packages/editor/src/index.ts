/**
 * `@scenoco-three/editor` — the programmatic API behind the `scenoco-editor` CLI.
 *
 * Serves the editor page, bridges it to an MCP server over a WebSocket, and exposes MCP tools
 * that **observe**: open, screenshot, telemetry, play/pause/stop, simulate. Documents are changed
 * by editing the XML; there is no remote edit tool, by decision.
 */
export {
  startEditorServer,
  applyEdits,
  type ServerOptions,
  type EditorServer,
  type EditorBridge,
  type Edit,
} from './server.js';
export { createMcpServer, startMcpHttp } from './mcp.js';
export {
  WS_PATH,
  commandId,
  type EditorCommand,
  type EditorPush,
  type EditorResponse,
  type EditorResult,
  type PreviewFrame,
  type SimStep,
} from './protocol.js';
