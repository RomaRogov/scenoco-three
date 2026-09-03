/**
 * `@scenoco-three/observer` — the programmatic API behind the `scenoco-observer` CLI.
 *
 * A dev server that compiles the project and serves a page running the real scene; a browser
 * the observer launches and asks directly; and an MCP server whose tools **observe**: open,
 * outline, screenshot, telemetry, play/pause/stop, simulate. `simulate`'s `eval` step is the
 * one thing with hands, and its hands reach the running scene only.
 */
export { startProjectServer, type ServerOptions, type ProjectServer } from './server.js';
export { openScenePage, type BrowserOptions, type ScenePage } from './browser.js';
export { createMcpServer, startMcpHttp, startMcpStdio } from './mcp.js';
export type { ObserverCommand, ObserverResult, PreviewFrame, SimStep } from './protocol.js';
