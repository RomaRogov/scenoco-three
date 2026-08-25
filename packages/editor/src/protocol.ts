/**
 * The contract between the Node side and the editor page.
 *
 * Pure types plus one correlation helper, so both ends agree and the relay is testable on its
 * own. Nothing here reaches the compiler: the browser holds no compiler in v2 either.
 *
 * ### What is deliberately absent
 *
 * v1 carried an editing half — `EditTarget`, `EditOp`, `StructuralOp`, and `CompiledScene`
 * fragments travelling over the wire so a remote caller could reshape a document. All of it is
 * gone. An agent has file tools and the watcher rebuilds either way, so a second write path into
 * the user's source bought nothing and cost the guarantee that every change to their scene went
 * through their editor, their diff and their undo.
 *
 * What remains is observation: open, render, drive, sample.
 */

/** WebSocket path the editor page connects to. */
export const WS_PATH = '/scenoco-ws';

/**
 * How a capture is rendered — everything except *where the camera is*.
 *
 * Framing belongs to the individual shot and changes between them; this is the output format,
 * and it is the same for every capture in one command. So it sits on the command rather than on
 * each step: one simulation renders one way throughout, and two shots of the same run stay
 * comparable because nothing but the camera moved between them.
 */
export interface PreviewFrame {
  width: number;
  height: number;
  /**
   * Include the screen-space UI layer — a `<Canvas>` HUD and anything else parented to a camera.
   * The shot is then framed *through* that camera, which is what puts the HUD where the player
   * sees it rather than floating in world space in front of a camera nobody is looking through.
   */
  ui: boolean;
}

/** A command sent Node → editor page, correlated with its reply by `id`. */
export type EditorCommand =
  | { id: string; type: 'open'; path: string }
  | { id: string; type: 'preview'; camera: string; lookAt?: string; frame: PreviewFrame }
  | { id: string; type: 'run' }
  | { id: string; type: 'pause' }
  | { id: string; type: 'stop' }
  | { id: string; type: 'telemetry'; targetId: string }
  | { id: string; type: 'simulate'; steps: SimStep[]; frame: PreviewFrame };

/**
 * One step in a `simulate` batch — transport, frame stepping, synthetic input, or a capture.
 *
 * Run in order against the live engine, so a caller can drive the game to a precise condition
 * and sample it there. This is the whole reason the editor is worth having for an agent: a
 * screenshot of frame zero says almost nothing about whether a game works.
 */
export type SimStep =
  | { do: 'play' | 'pause' | 'stop' }
  /** Advance by `frames` ticks (default 1) of `dt` seconds (default 1/60). */
  | { do: 'step'; frames?: number; dt?: number }
  /**
   * Keyboard. `key` is a `KeyCode` member name — `Space`, `W`, `LeftArrow`; an unknown one fails
   * the batch with the valid list rather than doing nothing. Each action is its own verb.
   */
  | { do: 'press'; key: string }
  | { do: 'keyDown'; key: string }
  | { do: 'keyUp'; key: string }
  /** Mouse. `x,y` are canvas-relative pixels from the top left; `click` is down plus up. */
  | { do: 'click'; x?: number; y?: number; button?: 'left' | 'right' | 'middle' }
  | { do: 'move'; x?: number; y?: number; dx?: number; dy?: number }
  /**
   * Capture a PNG. `camera` is a position in the document's own vector grammar
   * (`"y: 6; z: 12"`), or `"fit"` to frame the whole scene. Size and UI come from the batch's
   * `frame` — see {@link PreviewFrame} for why they are not repeated per step.
   */
  | { do: 'preview'; camera: string; lookAt?: string }
  /** Sample state at an `id` the document declares — a node and its components. */
  | { do: 'telemetry'; id: string };

/** The page's reply, keyed by the command id. */
export type EditorResponse =
  | { id: string; ok: true; result: EditorResult }
  | { id: string; ok: false; error: string };

/**
 * An unsolicited Node → page notification.
 *
 * - `documentChanged` — the open document, or something it references, changed on disk. The page
 *   reloads the scene.
 * - `buildFailed` — a document no longer compiles. The page shows the diagnostics rather than
 *   reloading into a broken scene.
 * - `shutdown` — the server is stopping, so the page closes itself instead of being left stale.
 */
export type EditorPush =
  | { push: 'documentChanged'; file: string }
  | { push: 'buildFailed'; message: string }
  | { push: 'shutdown' };

/** Result payloads, discriminated by `kind`. */
export type EditorResult =
  | { kind: 'ok'; info?: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'json'; data: unknown }
  /** `simulate` — one entry per capturing step, in order. */
  | { kind: 'multi'; results: EditorResult[] };

/** Random correlation id for a command. */
export function commandId(): string {
  return Math.random().toString(36).slice(2, 10);
}
