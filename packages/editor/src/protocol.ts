// Shared command/response protocol for the WebSocket bridge between the MCP
// server (Node) and the editor app (browser). Pure types + a tiny correlation
// helper, so both ends agree and the relay logic is unit-testable.

import type { CameraFitModeName, CompiledAsset, CompiledComponent, CompiledScene } from '@scenoco-three/core';
// Type-only: erased at build (verbatimModuleSyntax), so the browser bundle never
// pulls in the compiler. Direction is editor → compiler, never the reverse.
import type { MemberRef, NodeRef } from '@scenoco-three/compiler';

/** WebSocket path the editor connects to on the dev server. */
export const WS_PATH = '/scenoco-ws';

/**
 * How a capture is rendered — everything except *where the camera is*.
 *
 * Framing (`camera`/`lookAt`) belongs to the individual shot and changes between
 * them; this is the output format, and it is the same for every capture in one
 * command. Hence it sits on the command, not on each `preview` step: one
 * simulation renders one way throughout, and two shots of the same run stay
 * comparable because nothing but the camera moved between them.
 */
export interface PreviewFrame {
  /** Captured image width in pixels. */
  width: number;
  /** Captured image height in pixels. */
  height: number;
  /**
   * How the rendering camera's frustum adapts to this frame's aspect — the
   * engine's own `<Camera fit=…>` modes, applied against the camera's authored
   * `designWidth`/`designHeight`. A camera with no design size has nothing to
   * adapt to, so every mode is a no-op for it.
   */
  fit: CameraFitModeName;
  /**
   * Include the screen-space UI layer (a `<Fullscreen>` HUD and anything else
   * parented to a camera). The shot is then framed *through* the camera hosting
   * that layer, which is what makes the HUD land where the player sees it rather
   * than floating in world space in front of a camera nobody is looking through.
   * `false` leaves it out entirely — the shot for checking geometry a HUD covers.
   */
  ui: boolean;
}

/** A command sent MCP-server → editor (id-correlated with its response). */
export type EditorCommand =
  | { id: string; type: 'open'; path: string }
  | { id: string; type: 'preview'; camera: string; lookAt?: string; frame: PreviewFrame }
  | { id: string; type: 'run' }
  | { id: string; type: 'pause' }
  | { id: string; type: 'stop' }
  | { id: string; type: 'telemetry'; targetId: string }
  | { id: string; type: 'simulate'; steps: SimStep[]; frame: PreviewFrame };

/**
 * One step in a `simulate` batch — transport, frame stepping, synthetic input, or
 * a capture. Executed in order against the live engine, so an agent can drive the
 * game to a precise condition and sample preview/telemetry there.
 */
export type SimStep =
  | { do: 'play' | 'pause' | 'stop' }
  /** Advance the simulation by `frames` ticks (default 1) of `dt` seconds (default 1/60). */
  | { do: 'step'; frames?: number; dt?: number }
  /**
   * Keyboard — `key` is a Unity `KeyCode` **member name** (e.g. 'Space', 'W',
   * 'LeftArrow'); an unknown name fails the batch with the valid list. Each
   * action is its own verb.
   */
  | { do: 'press'; key: string } // press + release, the usual way to trigger something
  | { do: 'keyDown'; key: string }
  | { do: 'keyUp'; key: string }
  /** Mouse — `x,y` canvas-relative px (top-left). `click` = down+up; button defaults to left. */
  | { do: 'click'; x?: number; y?: number; button?: 'left' | 'right' | 'middle' }
  | { do: 'move'; x?: number; y?: number; dx?: number; dy?: number }
  /** Gamepad: synthetic pad `index` (default 0) with pressed `buttons` + `axes`. */
  | { do: 'gamepad'; index?: number; buttons?: boolean[]; axes?: number[] }
  /**
   * Capture a PNG. `camera` is required: a position in the scene DSL's vector
   * grammar ("y: 6; z: 12", or the positional "0 6 12"), or "fit" to auto-frame
   * the scene. Size/fit/UI come from the batch's own `frame` — see
   * {@link PreviewFrame} for why they are not repeated here.
   */
  | { do: 'preview'; camera: string; lookAt?: string }
  /** Sample state at a scene id — a node (transform + its components) or a component. */
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
 * - `componentsChanged`: a project component source file was added, removed or
 *   edited. Component classes are ES modules already evaluated in the page, and
 *   re-importing one would re-run its decorator (a duplicate registration), so
 *   picking up new `@property` metadata needs a full page reload. That discards
 *   unsaved scene edits, hence the notification instead of a silent reload — the
 *   editor asks first when the document is dirty. `metaChanged` distinguishes an
 *   edit that altered the registered property surface (the inspector will render
 *   differently) from a body-only change.
 * - `shutdown`: the dev server is stopping; the editor page closes itself so no
 *   stale tab is left behind.
 */
export type EditorPush =
  | { push: 'fileChanged'; file: string; role: 'open' | 'dep' }
  | { push: 'componentsChanged'; metaChanged: boolean }
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
  /** The new compiled value, or `null` to remove the attribute from the source. */
  value: number | boolean | string | number[] | null;
}

// ── structural edits: an ordered op-log the server applies via the CST splicer ──────

/**
 * Addresses a node element by `id` first, else structural `path` (`[]` = the root).
 *
 * Re-exported from the compiler rather than redeclared: the op-log the editor sends
 * is applied by the compiler's CST splicer, so the two must address nodes
 * identically — a second declaration is a divergence waiting to happen. The import
 * is type-only, so nothing from the compiler reaches the browser bundle (the
 * dependency direction is editor → compiler; the compiler never knows about the
 * editor).
 */
export type { MemberRef, NodeRef };

/**
 * A structural change to the scene tree (reparent / remove / insert a node),
 * applied to the source XML on save (comment-preserving splice). Sent alongside
 * attribute `EditOp`s.
 *
 * `insertNode` carries the inserted subtree as an in-memory `CompiledScene`
 * **fragment** (root = the inserted node), not XML: the browser has no compiler, so
 * a paste keeps the compiled fragment (reused to spawn the subtree live via
 * `Engine.spawnSubtree`), and the server serializes it to XML with `serializeScene`
 * only at save time. The compiler's own `StructuralOp.insertNode` stays XML-based;
 * the save endpoint bridges the two.
 */
export type StructuralOp =
  | { op: 'moveNode'; target: NodeRef; parent: NodeRef; index?: number }
  | { op: 'removeNode'; target: NodeRef }
  | { op: 'insertNode'; parent: NodeRef; index?: number; fragment: CompiledScene }
  // Managing a node's components/attachments. Both are plain element edits with no
  // browser/compiler divergence, so they cross the bridge unchanged.
  | { op: 'removeMember'; target: MemberRef }
  | { op: 'moveMember'; target: MemberRef; index: number }
  /**
   * Add a component/attachment. Like `insertNode`, the browser sends the **compiled**
   * member rather than XML — it has no serializer — and the save endpoint turns it
   * into an element. Re-derived at send time, so edits made after adding are carried.
   */
  | {
      op: 'insertMember';
      node: NodeRef;
      block: 'Components' | 'Attachments';
      index?: number;
      member: { kind: 'component'; value: CompiledComponent } | { kind: 'attachment'; value: CompiledAsset };
    };
