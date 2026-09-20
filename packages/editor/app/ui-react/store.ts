import { create } from 'zustand';
import type { Object3D } from 'three';
import type { TagFamily } from '@scenoco-three/compiler';
import type { EditorDeps } from './types.js';

/**
 * The editor chrome's UI state. There's exactly one editor per page, so the store
 * is a module singleton — `initStore` injects the host deps once (before the React
 * tree renders) and the actions relay to them.
 *
 * `rev` is a monotonic counter bumped on every `refresh()`: components that read
 * live engine/document values subscribe to it so an external change, an edit, or a
 * playback transition re-renders them without threading the data through props.
 */

/**
 * What the picker is being opened to fill: behaviour hung on the node, or one of the objects the
 * node is *built from*. It offers every component class, or every tag of the slot's family.
 */
export type AddTarget =
  | { kind: 'component'; node: Object3D }
  | { kind: 'slot'; node: Object3D; slot: string; family: TagFamily };

interface UIState {
  selected: Object3D | null;
  nodesOpen: boolean;
  inspectorOpen: boolean;
  /** Portrait forces the two sheets to be mutually exclusive (phones); landscape allows both. */
  portrait: boolean;
  /** What the picker is open for, if it is. */
  adding: AddTarget | null;
  rev: number;
  select: (node: Object3D | null) => void;
  openNodes: () => void;
  closeNodes: () => void;
  openInspector: () => void;
  closeInspector: () => void;
  setPortrait: (portrait: boolean) => void;
  openAdd: (target: AddTarget) => void;
  closeAdd: () => void;
  bump: () => void;
}

let deps: EditorDeps | undefined;

/** Inject the host deps. Called by `mountEditorUI` before the first render. */
export function initStore(d: EditorDeps): void {
  deps = d;
}

/** The host deps, once injected (actions run only after mount, so this is set). */
export function getDeps(): EditorDeps {
  if (!deps) throw new Error('editor UI store used before initStore()');
  return deps;
}

export const useUI = create<UIState>((set, get) => ({
  selected: null,
  nodesOpen: false,
  inspectorOpen: false,
  portrait: false,
  adding: null,
  rev: 0,

  // `rev` moves with the selection because the toolbar's state is derived from it: the transform
  // modes are only meaningful with something selected, and `handlers.state()` is read at render
  // time rather than subscribed to. Without the bump, TopBar (which subscribes to `rev` alone)
  // keeps the enablement it was last drawn with, and Move/Rotate/Scale stay grey over a node
  // the gizmo is visibly attached to.
  select: (node) => {
    set((s) => ({ selected: node, rev: s.rev + 1 }));
    getDeps().onSelect(node); // host highlights + frames it in the viewport
  },

  // Opening one sheet closes the other only in portrait (a phone can't show both);
  // in landscape they coexist.
  openNodes: () => set((s) => ({ nodesOpen: true, inspectorOpen: s.portrait ? false : s.inspectorOpen })),
  closeNodes: () => set({ nodesOpen: false }),
  openInspector: () => set((s) => ({ inspectorOpen: true, nodesOpen: s.portrait ? false : s.nodesOpen })),
  closeInspector: () => set({ inspectorOpen: false }),

  openAdd: (target) => set({ adding: target }),
  closeAdd: () => set({ adding: null }),

  // On rotating to portrait with both open, drop the node list (keep the inspector focused).
  setPortrait: (portrait) =>
    set((s) => ({ portrait, nodesOpen: portrait && s.inspectorOpen ? false : s.nodesOpen })),

  bump: () => set({ rev: get().rev + 1 }),
}));
