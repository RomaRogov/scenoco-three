/** @jsxImportSource react */
/**
 * The editor's interface: a toolbar, a node list and an inspector over a scene the game's own page
 * built and holds still (`play()` with `?edit`). It imports nothing at runtime from the page —
 * three.js and the scene come through `EditHost` — so one bundle serves any project.
 *
 * Laid out for a phone as much as a desk: held upright the node list and the inspector are bottom
 * sheets, one at a time; turned sideways, or on a screen, they are side columns that can both be
 * open. Every control is a finger's width.
 */
import { createRoot } from 'react-dom/client';
import type { EditHost } from '@scenoco-three/core';
import { Controller, type Mode } from './controller.js';
import { App } from './ui/App.js';
import { initStore, useUI } from './ui/store.js';
import { STYLE } from './style.js';

export function mount(host: EditHost): void {
  const controller = new Controller(host);
  initStore(controller);
  controller.changed = () => useUI.getState().bump();

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  // A phone lays the page out at its own width only when the page says so; a game's page may not.
  if (!document.querySelector('meta[name=viewport]')) {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    document.head.appendChild(meta);
  }
  const root = document.createElement('div');
  root.id = 'scenoco-editor';
  document.body.appendChild(root);
  // No StrictMode: its double mount gives react-arborist's drag backend two instances, which throws.
  createRoot(root).render(<App />);

  const upright = matchMedia('(orientation: portrait)');
  const orient = () => useUI.getState().setPortrait(upright.matches);
  orient();
  upright.addEventListener('change', orient);

  host.on('select', (node) => {
    useUI.setState({ selected: node });
    // A pick in the viewport is a request to see what was picked.
    if (node) useUI.getState().openInspector();
    controller.changed();
  });
  host.on('transform', () => controller.changed());

  addEventListener('keydown', (event) => {
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      void controller.step(key === 'z' && !event.shiftKey);
      return;
    }
    const mode = ({ w: 'translate', e: 'rotate', r: 'scale' } as Record<string, Mode>)[key];
    if (mode) controller.setMode(mode);
    if (key === 'f' && host.selected) host.frame(host.selected);
    if (event.key === 'Escape') host.select(null);
  });
  controller.setMode('translate');
}
