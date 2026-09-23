/**
 * The contract between the observer and its page.
 *
 * Pure types plus one correlation helper, so both ends agree and the relay is testable on its
 * own. Nothing here reaches the compiler: the browser holds no compiler in v2 either.
 *
 * There is no editing half. An agent has file tools and the watcher rebuilds either way, so a
 * second write path into the user's source would only cost the guarantee that every change to
 * their scene goes through the tools they already have — their own editing, diff and undo.
 *
 * What remains is observation: open, render, drive, sample.
 */

/**
 * The window a call runs the game in when it names no size.
 *
 * A call's frame is the page's own size, not a picture scaled from it: the game resizes to it, so
 * a point read off a shot is the point to `click`. Pictures scaled from a canvas of another size
 * once sent clicks 20% low, and an agent reported that buttons do not work.
 */
export const FRAME = { width: 800, height: 500 } as const;

/**
 * The window a call runs in, and how its captures are rendered — everything except *where the
 * camera is*.
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
      cameraPos?: string;
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
  /**
   * The pointer — a mouse, or a finger. `x,y` are canvas-relative pixels from the top left, and
   * left out they mean *where the pointer already is*, as a still hand would. `click` is down
   * plus up; `pointerDown` and `pointerUp` hold and release, so a drag is down, then `move`s with
   * `step`s between them, then up. `move` takes a point, or `dx,dy` from where it is.
   */
  | { do: 'click'; x?: number; y?: number; button?: PointerButton }
  | { do: 'pointerDown'; x?: number; y?: number; button?: PointerButton }
  | { do: 'pointerUp'; x?: number; y?: number; button?: PointerButton }
  | { do: 'move'; x?: number; y?: number; dx?: number; dy?: number }
  /**
   * Capture a PNG. `cameraPos` and `lookAt` are positions in the document's own vector grammar
   * (`"y: 6; z: 12"`), and `fov` is the vertical field of view in degrees. Nothing is derived:
   * three numbers a caller states, and the same three give the same picture. Size comes from the
   * batch's `frame` — see {@link PreviewFrame}; UI too, unless the step says `ui` itself, which a
   * caller reaching for "this shot with the HUD" writes there.
   */
  | { do: 'preview'; cameraPos?: string; lookAt?: string; fov?: number; ui?: boolean }
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

export type PointerButton = 'left' | 'right' | 'middle';
