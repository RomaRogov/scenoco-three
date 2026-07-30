import type { Object3D } from 'three';
import type { Engine } from '@scenoco-three/core';
import type { SceneDocument } from '../document.js';
import type { GizmoMode } from '../gizmo.js';

/**
 * The transport/gizmo/edit actions the top bar drives, plus a `state()` snapshot
 * it polls to style itself. Structurally identical to what `main.ts` already
 * builds — moved here from the old `toolbar.ts` so the React chrome owns the type.
 */
export interface ToolbarHandlers {
  // transport
  play(): void;
  pause(): void;
  step(): void;
  stop(): void;
  // gizmo + edit
  getMode(): GizmoMode;
  setMode(mode: GizmoMode): void;
  undo(): void;
  redo(): void;
  save(): void;
  /** Current state, re-read on each refresh. */
  state(): {
    mode: 'edit' | 'play';
    playing: boolean;
    canUndo: boolean;
    canRedo: boolean;
    dirty: boolean;
    saving: boolean;
    enabled: boolean;
  };
}

/**
 * Everything the React chrome needs from the host page (`main.ts`): live getters
 * for the engine/document, the toolbar handlers, a selection callback (viewport
 * highlight + framing), and a "focus the current selection" action.
 */
export interface EditorDeps {
  getEngine: () => Engine;
  getDoc: () => SceneDocument | undefined;
  handlers: ToolbarHandlers;
  /** Called whenever selection changes (from the tree or the viewport) — host highlights/frames it. */
  onSelect: (node: Object3D | null) => void;
  /** Reframe the camera on a node (the node-list "focus" action). */
  focusSelected: (node: Object3D) => void;
  /** Reparent a node under a new parent (tree drag) — records an undoable move. */
  reparent: (node: Object3D, newParent: Object3D, index?: number) => void;
  /** Copy a node's subtree to the clipboard. */
  copy: (node: Object3D) => void;
  /** Cut (copy + delete) a node's subtree. */
  cut: (node: Object3D) => void;
  /** Paste the clipboard subtree under `parent` (the scene root when null). */
  paste: (parent: Object3D | null) => void;
  /** Delete a node's subtree (undoable). */
  remove: (node: Object3D) => void;
  /** Rename (or set) a node's scene id. */
  setId: (node: Object3D, id: string) => void;
  /** Whether the clipboard holds a subtree (for Paste's enabled state). */
  hasClipboard: () => boolean;
}

/** The tiny imperative surface `main.ts` keeps a handle to (mirrors the old panels/toolbar). */
export interface EditorUIHandle {
  /** Re-read the live engine/document into the tree, inspector, and top bar. */
  refresh(): void;
  /** Select a node from outside (a viewport pick) — syncs tree + inspector. */
  select(node: Object3D | null): void;
}
