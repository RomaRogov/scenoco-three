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
  | { id: string; type: 'telemetry'; targetId: string }
  | { id: string; type: 'simulate'; steps: SimStep[] }
  | { id: string; type: 'edit'; edits: AgentEdit[] }
  | { id: string; type: 'save' };

/**
 * One scene edit an agent requests over MCP, addressed by scene id (the same ids
 * `get_telemetry` uses). Applied through the editor's document, so it is undoable,
 * dirty-flagging, and live in the viewport — exactly as if typed in the inspector.
 *
 * - `node` only: a transform attr (`position`/`eulerAngles`/`scale` as `[x,y,z]`,
 *   `eulerAngles` in degrees, `visible` as bool) or a prefab instance's `src`.
 * - `node` + `component`: a `@property` of the Nth `<component>` on that node.
 * - `node` + `attachment`: an attr of the Nth `<attachment>` (geometry/material)
 *   on that node.
 *
 * Values use the compiled form (vecs as number arrays, colors as hex ints);
 * strings like "3 1 0" or "#ff0000" are coerced where the target type is known.
 */
export interface AgentEdit {
  /** Scene id of the target node (required in v1 — id-less nodes aren't addressable over MCP). */
  node: string;
  /** Component tag on that node (e.g. "Ball"). */
  component?: string;
  /** Attachment tag on that node (e.g. "MeshStandardMaterial"). */
  attachment?: string;
  /** Ordinal among same-tag components/attachments on the node. Default 0. */
  ordinal?: number;
  attr: string;
  value: string | number | boolean | number[];
}

/**
 * One step in a `simulate` batch — transport, frame stepping, synthetic input, or
 * a capture. Executed in order against the live engine, so an agent can drive the
 * game to a precise condition and sample preview/telemetry there.
 */
export type SimStep =
  | { do: 'play' | 'pause' | 'stop' }
  /** Advance the simulation by `frames` ticks (default 1) of `dt` seconds (default 1/60). */
  | { do: 'step'; frames?: number; dt?: number }
  /** Keyboard — `key` is a Unity KeyCode name (e.g. 'Space', 'W'). Each action is its own verb. */
  | { do: 'tap'; key: string } // press + release
  | { do: 'keyDown'; key: string }
  | { do: 'keyUp'; key: string }
  /** Mouse — `x,y` canvas-relative px (top-left). `click` = down+up; button defaults to left. */
  | { do: 'click'; x?: number; y?: number; button?: 'left' | 'right' | 'middle' }
  | { do: 'move'; x?: number; y?: number; dx?: number; dy?: number }
  /** Gamepad: synthetic pad `index` (default 0) with pressed `buttons` + `axes`. */
  | { do: 'gamepad'; index?: number; buttons?: boolean[]; axes?: number[] }
  | { do: 'preview'; camera?: string; lookAt?: string }
  | { do: 'telemetry'; id: string };

/** The editor's reply, keyed by the command id. */
export type EditorResponse =
  | { id: string; ok: true; result: EditorResult }
  | { id: string; ok: false; error: string };

/**
 * An unsolicited server→editor notification (not id-correlated).
 *
 * - `fileChanged`: a watched file changed on disk — the open scene/prefab
 *   (`role: 'open'`) or one of its `src=` deps, a prefab/material (`role: 'dep'`).
 * - `shutdown`: the dev server is stopping; the editor page closes itself so no
 *   stale tab is left behind.
 */
export type EditorPush =
  | { push: 'fileChanged'; file: string; role: 'open' | 'dep' }
  | { push: 'shutdown' };

/** Result payloads, discriminated by `kind`. */
export type EditorResult =
  | { kind: 'ok'; info?: string } // run / pause / stop / open
  | { kind: 'image'; dataUrl: string } // preview — PNG data URL
  | { kind: 'json'; data: unknown } // telemetry
  | { kind: 'multi'; results: EditorResult[] }; // simulate — ordered captures

/** Random correlation id for a command. */
export function commandId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── editing: a stateful, savable change to one source attribute ──────────────────

/**
 * Which compiled element an edit targets. The patcher locates the source element
 * by `id` first (ids survive structural file edits); when the node has no id it
 * falls back to the structural `path`/`nodePath` — ordinals among node-kind child
 * elements from the root. `tag` verifies a path-located element, so an edit made
 * against a stale file resolves to "unresolved" instead of patching the wrong node.
 */
export type EditTarget =
  | {
      kind: 'node';
      nodeIndex: number;
      id?: string;
      /** Structural fallback: child ordinals (node-kind elements only) from the root; `[]` = the root itself. */
      path?: number[];
      /** The compiled node tag, verified against a path-located element. */
      tag?: string;
    }
  | {
      kind: 'component';
      componentIndex: number;
      nodeIndex: number;
      nodeId?: string;
      /** Structural fallback for an id-less owning node (see the node variant's `path`). */
      nodePath?: number[];
      /** Component tag + its ordinal among same-typed components on the node. */
      type: string;
      ordinal: number;
    }
  | {
      kind: 'attachment';
      nodeIndex: number;
      /** Owning node id; absent for the scene-root, which `root` then marks. */
      nodeId?: string;
      /** Structural fallback for an id-less owning node (see the node variant's `path`). */
      nodePath?: number[];
      root?: boolean;
      /** Attachment tag + its ordinal among same-tag attachments on the node. */
      tag: string;
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

// ── structural edits: an ordered op-log the server applies via the CST splicer ──────

/** Addresses a node element by `id` first, else structural `path` (`[]` = the root). */
export interface NodeRef {
  id?: string;
  path?: number[];
  tag?: string;
}

/**
 * A structural change to the scene tree (reparent / remove / insert a node),
 * applied to the source XML by `applyStructuralOps` (comment-preserving splice).
 * Mirrors the compiler's `StructuralOp`; sent alongside attribute `EditOp`s on save.
 */
export type StructuralOp =
  | { op: 'moveNode'; target: NodeRef; parent: NodeRef; index?: number }
  | { op: 'removeNode'; target: NodeRef }
  | { op: 'insertNode'; parent: NodeRef; index?: number; xml: string };
