/**
 * The contract between the observer and its page.
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
 * through the tools they already have — their own editing, their diff and their undo.
 *
 * What remains is observation: open, render, drive, sample.
 */

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

/** A command sent Node → the observer's page, correlated with its reply by `id`. */
export type ObserverCommand =
  | { id: string; type: 'open'; path: string }
  | {
      id: string;
      type: 'preview';
      cameraPos: string;
      lookAt?: string;
      fov?: number;
      frame: PreviewFrame;
    }
  | { id: string; type: 'run' }
  | { id: string; type: 'pause' }
  | { id: string; type: 'stop' }
  | { id: string; type: 'telemetry'; targetId: string }
  /** The scene as text — see `ObserverSession.outline`. */
  | { id: string; type: 'outline'; targetId?: string; depth?: number }
  | { id: string; type: 'simulate'; steps: SimStep[]; frame: PreviewFrame };

/**
 * One step in a `simulate` batch — transport, frame stepping, synthetic input, or a capture.
 *
 * Run in order against the live engine, so a caller can drive the game to a precise condition
 * and sample it there. This is the whole reason the observer is worth having for an agent: a
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
  /**
   * The named input entries, spelled as Unity spells them, so a batch drives what the game
   * actually reads: gameplay is written against `getAxis('Horizontal')`, not against A and D.
   *
   * `axis` holds a value until it is changed or released with `null` — a stick stays where a
   * thumb leaves it — and while it is held the keys for that axis are ignored. `button` is a
   * one-frame press; `buttonDown` / `buttonUp` hold and release.
   */
  | { do: 'axis'; axis: string; value: number | null }
  | { do: 'button'; button: string }
  | { do: 'buttonDown'; button: string }
  | { do: 'buttonUp'; button: string }
  /** Mouse. `x,y` are canvas-relative pixels from the top left; `click` is down plus up. */
  | { do: 'click'; x?: number; y?: number; button?: 'left' | 'right' | 'middle' }
  | { do: 'move'; x?: number; y?: number; dx?: number; dy?: number }
  /**
   * Capture a PNG. `cameraPos` and `lookAt` are positions in the document's own vector grammar
   * (`"y: 6; z: 12"`), and `fov` is the vertical field of view in degrees. Nothing is derived:
   * three numbers a caller states, and the same three give the same picture. Size and UI come
   * from the batch's `frame` — see {@link PreviewFrame} for why they are not repeated per step.
   */
  | { do: 'preview'; cameraPos: string; lookAt?: string; fov?: number }
  /** Sample state at an `id` the document declares — a node and its components. */
  | { do: 'telemetry'; id: string }
  /** JavaScript run as the body of an async function against the live scene; its return value comes back. */
  | { do: 'eval'; code: string }
  /** The scene, or the subtree under `id`, as text. */
  | { do: 'outline'; id?: string; depth?: number };

/** Result payloads, discriminated by `kind`. */
export type ObserverResult =
  | { kind: 'ok'; info?: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'json'; data: unknown }
  /** Prose meant to be read as-is, not a JSON value. */
  | { kind: 'text'; text: string }
  /** `simulate` — one entry per capturing step, in order. */
  | { kind: 'multi'; results: ObserverResult[] };

