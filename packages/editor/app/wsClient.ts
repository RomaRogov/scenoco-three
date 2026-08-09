import { WS_PATH, type EditorCommand, type EditorPush, type EditorResponse, type EditorResult } from '../src/protocol.js';
import type { EditorSession } from './session.js';

/**
 * Connect the editor page to the dev server's WebSocket bridge and execute the
 * commands the MCP server relays, replying with the result (id-correlated).
 * Auto-reconnects (e.g. across a dev-server restart) — including after a graceful
 * shutdown: the server serves on a sticky port, so this same tab reattaches on a
 * restart rather than being stranded or replaced by a fresh one.
 */
export function connectEditor(session: EditorSession): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}${WS_PATH}`;

  // The server told us it's stopping; we keep reconnecting anyway (a restart
  // reclaims the sticky port), and show a "waiting for restart" overlay meanwhile.
  let awaitingRestart = false;

  const open = (): void => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      if (!awaitingRestart) return;
      // A restart reclaimed the port — revive this tab. Vite's own HMR reconnect
      // usually full-reloads it to pick up fresh component code; if it doesn't,
      // the live session just resumes with the bridge (hence MCP) working again.
      awaitingRestart = false;
      clearStoppedOverlay();
    };
    ws.onmessage = async (ev) => {
      let msg: EditorCommand | EditorPush;
      try {
        msg = JSON.parse(ev.data as string) as EditorCommand | EditorPush;
      } catch {
        return;
      }
      // Unsolicited server pushes — not id-correlated commands.
      if ('push' in msg) {
        if (msg.push === 'shutdown') serverStopping();
        else if (msg.push === 'componentsChanged') session.onComponentsChanged?.(msg.metaChanged);
        else session.onExternalChange?.(msg.file, msg.role);
        return;
      }
      const cmd = msg;
      let response: EditorResponse;
      try {
        response = { id: cmd.id, ok: true, result: await runCommand(session, cmd) };
      } catch (e) {
        response = { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      ws.send(JSON.stringify(response));
    };
    // Always retry: an ungraceful death leaves this loop reconnecting, and a
    // graceful stop now revives on restart too (see serverStopping / onopen).
    ws.onclose = () => setTimeout(open, 1000);
    ws.onerror = () => ws.close();
  };
  open();

  /**
   * The dev server is shutting down. Best-effort close this tab — `window.close()`
   * only succeeds for a tab the script itself opened (the platform `open` at
   * launch). If the browser blocks it, leave the live app in place under a
   * non-destructive "waiting for restart" overlay and keep reconnecting, so a
   * restart on the sticky port reattaches this tab instead of opening a new one.
   */
  function serverStopping(): void {
    awaitingRestart = true;
    window.close();
    setTimeout(() => {
      if (awaitingRestart) showStoppedOverlay(); // still here (close blocked) and not yet reconnected
    }, 150);
  }
}

const STOPPED_OVERLAY_ID = 'sc-stopped';
let savedTitle: string | undefined;

/**
 * A non-destructive overlay shown while the dev server is down and this tab is
 * waiting for it to come back (a restart on the sticky port). Drawn *over* the
 * live app rather than replacing it, so reconnecting simply removes it and the
 * editor resumes — no reload required.
 */
function showStoppedOverlay(): void {
  if (document.getElementById(STOPPED_OVERLAY_ID)) return;
  savedTitle = document.title;
  document.title = '⏸ Editor stopped';
  const el = document.createElement('div');
  el.id = STOPPED_OVERLAY_ID;
  el.style.cssText =
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
    'text-align:center;font:500 15px system-ui,sans-serif;color:#9aa4b2;' +
    'background:rgba(10,14,22,0.86);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)';
  el.textContent = 'Editor server stopped — waiting for it to restart…';
  document.body.append(el);
}

function clearStoppedOverlay(): void {
  const el = document.getElementById(STOPPED_OVERLAY_ID);
  if (!el) return;
  el.remove();
  if (savedTitle !== undefined) {
    document.title = savedTitle;
    savedTitle = undefined;
  }
}

/**
 * Execute one relayed command against the session. Exported so the command
 * dispatch (not just the WS plumbing) can be driven directly in tests.
 */
export async function runCommand(session: EditorSession, cmd: EditorCommand): Promise<EditorResult> {
  switch (cmd.type) {
    case 'open':
      return { kind: 'json', data: await session.open(cmd.path) };
    case 'preview':
      return { kind: 'image', dataUrl: await session.preview({ camera: cmd.camera, lookAt: cmd.lookAt, frame: cmd.frame }) };
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
      return { kind: 'multi', results: await session.simulate(cmd.steps, cmd.frame) };
  }
}
