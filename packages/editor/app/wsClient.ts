import { WS_PATH, type AgentEdit, type EditorCommand, type EditorPush, type EditorResponse, type EditorResult } from '../src/protocol.js';
import type { EditorSession } from './session.js';

/**
 * What the host page (main) exposes for scene-mutating commands — the live
 * document's edit funnel and the save path, both shared with the human UI so an
 * agent's changes are undoable and visible exactly like inspector edits.
 */
export interface EditorHost {
  edit(edits: AgentEdit[]): { applied: number; failed: { edit: AgentEdit; reason: string }[] };
  save(): Promise<{ changed: number; unresolved: number }>;
}

/**
 * Connect the editor page to the dev server's WebSocket bridge and execute the
 * commands the MCP server relays, replying with the result (id-correlated).
 * Auto-reconnects (e.g. across a dev-server restart).
 */
export function connectEditor(session: EditorSession, host: EditorHost): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}${WS_PATH}`;

  let stopped = false; // set on a shutdown push — don't reconnect to a dead server

  const open = (): void => {
    const ws = new WebSocket(url);
    ws.onmessage = async (ev) => {
      let msg: EditorCommand | EditorPush;
      try {
        msg = JSON.parse(ev.data as string) as EditorCommand | EditorPush;
      } catch {
        return;
      }
      // Unsolicited server pushes — not id-correlated commands.
      if ('push' in msg) {
        if (msg.push === 'shutdown') {
          stopped = true;
          closeEditorTab();
        } else {
          session.onExternalChange?.(msg.file, msg.role);
        }
        return;
      }
      const cmd = msg;
      let response: EditorResponse;
      try {
        response = { id: cmd.id, ok: true, result: await runCommand(session, cmd, host) };
      } catch (e) {
        response = { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      ws.send(JSON.stringify(response));
    };
    ws.onclose = () => {
      if (!stopped) setTimeout(open, 1000);
    };
    ws.onerror = () => ws.close();
  };
  open();
}

/**
 * The dev server stopped: close this tab. `window.close()` only succeeds for a
 * tab the script itself opened (or one Chrome deems closable) — if the browser
 * blocks it, fall back to a "server stopped" placeholder so the stale page is
 * obvious and inert rather than silently retrying a dead connection.
 */
function closeEditorTab(): void {
  window.close();
  setTimeout(() => {
    document.title = 'Editor stopped';
    document.body.innerHTML =
      '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font:500 15px system-ui,sans-serif;color:#9aa4b2;background:#0a0e16">' +
      'Editor server stopped — you can close this tab.</div>';
  }, 150);
}

/**
 * Execute one relayed command against the session. Exported so the command
 * dispatch (not just the WS plumbing) can be driven directly in tests.
 */
export async function runCommand(session: EditorSession, cmd: EditorCommand, host: EditorHost): Promise<EditorResult> {
  switch (cmd.type) {
    case 'open':
      return { kind: 'json', data: await session.open(cmd.path) };
    case 'preview':
      return { kind: 'image', dataUrl: session.preview({ camera: cmd.camera, lookAt: cmd.lookAt }) };
    case 'run':
      session.run();
      return { kind: 'ok', info: 'playing' };
    case 'pause':
      session.pause();
      return { kind: 'ok', info: 'paused' };
    case 'stop':
      session.stop();
      return { kind: 'ok', info: 'edit mode' };
    case 'telemetry':
      return { kind: 'json', data: session.telemetry(cmd.targetId) };
    case 'simulate':
      return { kind: 'multi', results: session.simulate(cmd.steps) };
    case 'edit':
      return { kind: 'json', data: host.edit(cmd.edits) };
    case 'save':
      return { kind: 'json', data: await host.save() };
  }
}
