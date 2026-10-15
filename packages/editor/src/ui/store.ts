import { create } from 'zustand';
import type { Object3D } from 'three';
import type { Controller } from '../controller.js';

/**
 * The interface's state. One editor per page, so the store is a module singleton; `rev` moves on
 * every change the controller reports, and what reads live values subscribes to it.
 */
interface UIState {
  selected: Object3D | null;
  nodesOpen: boolean;
  inspectorOpen: boolean;
  /** A phone held upright shows one sheet at a time; landscape shows both, as side columns. */
  portrait: boolean;
  rev: number;
  openNodes: () => void;
  closeNodes: () => void;
  openInspector: () => void;
  closeInspector: () => void;
  setPortrait: (portrait: boolean) => void;
  bump: () => void;
}

let controller: Controller | undefined;

export function initStore(c: Controller): void {
  controller = c;
}

export function useController(): Controller {
  if (!controller) throw new Error('the editor interface rendered before initStore()');
  return controller;
}

export const useUI = create<UIState>((set, get) => ({
  selected: null,
  nodesOpen: false,
  inspectorOpen: false,
  portrait: false,
  rev: 0,
  openNodes: () => set((s) => ({ nodesOpen: true, inspectorOpen: s.portrait ? false : s.inspectorOpen })),
  closeNodes: () => set({ nodesOpen: false }),
  openInspector: () => set((s) => ({ inspectorOpen: true, nodesOpen: s.portrait ? false : s.nodesOpen })),
  closeInspector: () => set({ inspectorOpen: false }),
  // Turned upright with both open: keep the inspector, which is what a person is working in.
  setPortrait: (portrait) => set((s) => ({ portrait, nodesOpen: portrait && s.inspectorOpen ? false : s.nodesOpen })),
  bump: () => set({ rev: get().rev + 1 }),
}));
