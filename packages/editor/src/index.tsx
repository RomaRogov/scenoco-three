/** @jsxImportSource react */
/**
 * The editor's interface, over the running game: a toolbar, the scene's nodes, and the selected one
 * as the TSX that made it. `play()` loads it from the dev server when the page's edit button is
 * pressed; it imports nothing at runtime from the page — the game comes through `EditHost` — so
 * one bundle serves any project. `mount` puts the panel beside the game (`page.ts`), its state in
 * a `Model`, its parts in `ui/`, and its shortcuts on the keyboard (`keys.ts`).
 */
import { createRoot } from 'react-dom/client';
import type { EditHost } from '@scenoco-three/core';
import { listenForKeys } from './keys.js';
import { Model } from './model/Model.js';
import { fitPage } from './page.js';
import { STYLE } from './style.js';
import { App } from './ui/App.js';

export function mount(host: EditHost): () => void {
  const model = new Model(host);
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
  // Beside the body, which it shrinks: inside it, it would shrink with it.
  const element = document.createElement('div');
  element.id = 'scenoco-editor';
  document.documentElement.appendChild(element);
  const body = document.body;
  const before = body.getAttribute('style');
  body.classList.add('scenoco-editing');
  const unfit = fitPage(host, element);
  const mountPoint = document.createElement('div');
  mountPoint.className = 'se-mount';
  element.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  root.render(<App model={model} />);
  const unlisten = listenForKeys(host, model);
  // A reload, or leaving the page, would lose what is not saved: the browser asks first.
  const unload = (event: BeforeUnloadEvent) => {
    if (model.unsavedCount) event.preventDefault();
  };
  addEventListener('beforeunload', unload);

  return () => {
    unlisten();
    removeEventListener('beforeunload', unload);
    unfit();
    root.unmount();
    element.remove();
    style.remove();
    body.classList.remove('scenoco-editing');
    if (before === null) body.removeAttribute('style');
    else body.setAttribute('style', before);
    dispatchEvent(new Event('resize'));
  };
}
