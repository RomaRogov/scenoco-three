/** The editor's shortcuts — Unity's where it has one: W E R, F, ⌘D, Delete, Esc — and ⌘S, ⌘Z. */
import type { EditHost } from '@scenoco-three/core';
import type { Model } from './model/Model.js';

/** Listen for the shortcuts, and how to stop. */
export function listenForKeys(host: EditHost, model: Model): () => void {
  const keys = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void model.save();
      return;
    }
    if ((event.target as HTMLElement).closest('input, textarea')) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'z' && !event.shiftKey) model.undo();
      else model.redo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === 'd' && host.selected) {
      event.preventDefault();
      void model.restructure(host.selected, true);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && host.selected) {
      event.preventDefault();
      void model.restructure(host.selected, false);
      return;
    }
    const mode = ({ w: 'translate', e: 'rotate', r: 'scale' } as const)[key as 'w' | 'e' | 'r'];
    if (mode) model.setMode(mode);
    if (key === 'f' && host.selected) host.frame(host.selected);
    if (event.key === 'Escape') host.select(null);
  };
  addEventListener('keydown', keys);
  return () => removeEventListener('keydown', keys);
}
