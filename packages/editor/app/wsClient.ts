import { WS_PATH, type EditorCommand, type EditorResponse, type EditorResult } from '../src/protocol.js';
import type { EditorSession } from './session.js';

/**
 * Connect the editor page to the dev server's WebSocket bridge and execute the
 * commands the MCP server relays, replying with the result (id-correlated).
 * Auto-reconnects (e.g. across a dev-server restart).
 */
export function connectEditor(session: EditorSession): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}${WS_PATH}`;

  const open = (): void => {
    const ws = new WebSocket(url);
    ws.onmessage = async (ev) => {
      let cmd: EditorCommand;
      try {
        cmd = JSON.parse(ev.data as string) as EditorCommand;
      } catch {
        return;
      }
      let response: EditorResponse;
      try {
        response = { id: cmd.id, ok: true, result: await runCommand(session, cmd) };
      } catch (e) {
        response = { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      ws.send(JSON.stringify(response));
    };
    ws.onclose = () => setTimeout(open, 1000);
    ws.onerror = () => ws.close();
  };
  open();
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
  }
}
