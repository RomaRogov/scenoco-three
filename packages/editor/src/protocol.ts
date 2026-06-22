// Shared command/response protocol for the WebSocket bridge between the MCP
// server (Node) and the editor app (browser). Pure types + a tiny correlation
// helper, so both ends agree and the relay logic is unit-testable.

/** WebSocket path the editor connects to on the dev server. */
export const WS_PATH = '/scenoco-ws';

/** A command sent MCP-server → editor (id-correlated with its response). */
export type EditorCommand =
  | { id: string; type: 'open'; path: string }
  | { id: string; type: 'preview'; camera?: string; lookAt?: string; size?: string }
  | { id: string; type: 'run' }
  | { id: string; type: 'pause' }
  | { id: string; type: 'stop' }
  | { id: string; type: 'telemetry'; targetId: string };

/** The editor's reply, keyed by the command id. */
export type EditorResponse =
  | { id: string; ok: true; result: EditorResult }
  | { id: string; ok: false; error: string };

/** Result payloads, discriminated by `kind`. */
export type EditorResult =
  | { kind: 'ok'; info?: string } // run / pause / stop / open
  | { kind: 'image'; dataUrl: string } // preview — PNG data URL
  | { kind: 'json'; data: unknown }; // telemetry

/** Random correlation id for a command. */
export function commandId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── editing: a stateful, savable change to one source attribute ──────────────────

/**
 * Which compiled element an edit targets. Resolved server-side via the source
 * map (compiled index → source element), so it survives prefab expansion where
 * structural paths don't. `id`s are carried for readability/debugging.
 */
export type EditTarget =
  | { kind: 'node'; nodeIndex: number; id?: string }
  | {
      kind: 'component';
      componentIndex: number;
      nodeIndex: number;
      nodeId?: string;
      /** Component tag + its ordinal among same-typed components on the node. */
      type: string;
      ordinal: number;
    };

/**
 * One attribute change in compiled form (numbers/arrays/strings/bools). The
 * server serializes `value` to an attribute string using the registry codecs,
 * or removes the attribute when it equals the registry default (minimal diff).
 */
export interface EditOp {
  target: EditTarget;
  attr: string;
  value: number | boolean | string | number[];
}
