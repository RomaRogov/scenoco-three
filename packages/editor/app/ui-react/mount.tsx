import { createRoot } from 'react-dom/client';
import { EditorUI } from './EditorUI.js';
import { initStore, useUI } from './store.js';
import type { EditorDeps, EditorUIHandle } from './types.js';

/**
 * Mount the React editor chrome into `#sc-ui` and return the tiny imperative
 * surface `main.ts` drives — `refresh()` (re-read live engine/document state) and
 * `select(node)` (a viewport pick). Mirrors the old `buildPanels`/`buildToolbar`
 * handles so the host wiring stays minimal.
 */
export function mountEditorUI(deps: EditorDeps): EditorUIHandle {
  initStore(deps);

  const host = document.getElementById('sc-ui');
  if (!host) throw new Error('#sc-ui root missing');
  // No StrictMode: its dev double-mount makes react-arborist (react-dnd HTML5
  // backend) throw "Cannot have two HTML5 backends at the same time".
  createRoot(host).render(<EditorUI />);

  // Track orientation so the store can enforce one-sheet-at-a-time on phones.
  const mq = window.matchMedia('(orientation: portrait)');
  const syncOrientation = (): void => useUI.getState().setPortrait(mq.matches);
  syncOrientation();
  mq.addEventListener('change', syncOrientation);

  return {
    refresh: () => useUI.getState().bump(),
    select: (node) => useUI.getState().select(node),
  };
}
