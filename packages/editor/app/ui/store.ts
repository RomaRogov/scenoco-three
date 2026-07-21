import { create } from 'zustand';
import type { Object3D } from 'three';
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
interface UIState {
  selected: Object3D | null;
  nodesOpen: boolean;
  inspectorOpen: boolean;
  /** Portrait forces the two sheets to be mutually exclusive (phones); landscape allows both. */
  portrait: boolean;
  rev: number;
  select: (node: Object3D | null) => void;
  openNodes: () => void;
  closeNodes: () => void;
  openInspector: () => void;
  closeInspector: () => void;
  setPortrait: (portrait: boolean) => void;
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
  rev: 0,

  select: (node) => {
    set({ selected: node });
    getDeps().onSelect(node); // host highlights + frames it in the viewport
  },

  // Opening one sheet closes the other only in portrait (a phone can't show both);
  // in landscape they coexist.
  openNodes: () => set((s) => ({ nodesOpen: true, inspectorOpen: s.portrait ? false : s.inspectorOpen })),
  closeNodes: () => set({ nodesOpen: false }),
  openInspector: () => set((s) => ({ inspectorOpen: true, nodesOpen: s.portrait ? false : s.nodesOpen })),
  closeInspector: () => set({ inspectorOpen: false }),

  // On rotating to portrait with both open, drop the node list (keep the inspector focused).
  setPortrait: (portrait) =>
    set((s) => ({ portrait, nodesOpen: portrait && s.inspectorOpen ? false : s.nodesOpen })),

  bump: () => set({ rev: get().rev + 1 }),
}));
