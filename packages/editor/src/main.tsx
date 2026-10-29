/** @jsxImportSource react */
/**
 * The editor's interface, over the running game: a toolbar, the scene's nodes, and the selected one
 * as the TSX that made it. `play()` loads it from the dev server when the page's edit button is
 * pressed; it imports nothing at runtime from the page — the game comes through `EditHost` — so
 * one bundle serves any project.
 *
 * It takes a side of the screen rather than covering the game: a column on the right, or the lower
 * half of a phone held upright. Beside it the page's body is narrowed, and the game lays itself out
 * in what is left. Above it there is too little height for a layout made for a tall screen, so the
 * page is scaled down into the space at its full height: playing, in its own shape, centred, as it
 * will be played; paused, widened to fill the space, for the editor's own camera.
 */
import { createRoot } from 'react-dom/client';
import type { EditHost } from '@scenoco-three/core';
import { Model } from './model.js';
import { App } from './ui/App.js';
import { STYLE } from './style.js';

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
  /** Whether the page was last fitted for a paused game: it is fitted again when that changes. */
  let fittedPaused = host.paused;
  const fit = () => {
    const panel = element.getBoundingClientRect();
    fittedPaused = host.paused;
    if (innerHeight > innerWidth) {
      // Scaled down whole into the space, at its full height. Playing — Unity's Game view — it keeps
      // the phone's shape, centred: a game that frames itself by its screen frames itself as it will
      // be played. Paused — the Scene view, through the editor's own camera — it fills the space.
      const scale = Math.min(1, panel.top / innerHeight);
      const width = fittedPaused ? innerWidth / scale : innerWidth;
      const left = fittedPaused ? 0 : (innerWidth * (1 - scale)) / 2;
      Object.assign(body.style, { left: `${left}px`, top: '0', width: `${width}px`, height: `${innerHeight}px`, transform: `scale(${scale})`, transformOrigin: '0 0' });
    } else {
      Object.assign(body.style, { left: '0', top: '0', width: `${panel.left}px`, height: `${innerHeight}px`, transform: 'translateZ(0)', transformOrigin: '' });
    }
  };
  // The panel's size, dragged by its inner edge: its width beside the game, its height under it.
  const sizes = remembered();
  // What was chosen is kept; what fits the window now is what shows.
  const fits = (side: 'w' | 'h', px: number) => Math.round(Math.max(side === 'w' ? 260 : 180, Math.min(px, side === 'w' ? innerWidth - 160 : innerHeight - 120)));
  const apply = () => {
    for (const side of ['w', 'h'] as const) {
      const px = sizes[side];
      if (px) document.documentElement.style.setProperty(`--se-${side}`, `${fits(side, px)}px`);
    }
  };
  const setSize = (side: 'w' | 'h', px: number) => {
    sizes[side] = fits(side, px);
    apply();
  };
  apply();
  const grip = document.createElement('div');
  grip.className = 'se-grip';
  grip.title = 'Drag to resize';
  element.appendChild(grip);
  grip.addEventListener('pointerdown', (event) => {
    grip.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      if (innerHeight > innerWidth) setSize('h', innerHeight - e.clientY);
      else setSize('w', innerWidth - e.clientX);
      fit();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      remember(sizes);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  const refit = () => {
    apply();
    fit();
  };
  addEventListener('resize', refit);
  // Paused or played from anywhere — the toolbar, a reset, the page's bridge: fitted for it.
  let watching = requestAnimationFrame(function watch() {
    if (host.paused !== fittedPaused) fit();
    watching = requestAnimationFrame(watch);
  });
  fit();
  // The game measures the body on resize, and may do it before `fit` ran: tell it again once the
  // body's size settles — the observer only calls when the size changed, so this ends there.
  const settled = new ResizeObserver(() => dispatchEvent(new Event('resize')));
  settled.observe(body);
  const mountPoint = document.createElement('div');
  mountPoint.className = 'se-mount';
  element.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  root.render(<App model={model} />);

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
  // A reload, or leaving the page, would lose what is not saved: the browser asks first.
  const unload = (event: BeforeUnloadEvent) => {
    if (model.unsavedCount) event.preventDefault();
  };
  addEventListener('beforeunload', unload);

  return () => {
    removeEventListener('keydown', keys);
    removeEventListener('beforeunload', unload);
    removeEventListener('resize', refit);
    cancelAnimationFrame(watching);
    settled.disconnect();
    root.unmount();
    element.remove();
    style.remove();
    document.documentElement.style.removeProperty('--se-w');
    document.documentElement.style.removeProperty('--se-h');
    body.classList.remove('scenoco-editing');
    if (before === null) body.removeAttribute('style');
    else body.setAttribute('style', before);
    dispatchEvent(new Event('resize'));
  };
}

const SIZE_KEY = 'scenoco-editor-size';

/** The panel's last width and height, in pixels: this browser's, for every project it edits. */
function remembered(): { w?: number; h?: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? '{}') as { w?: unknown; h?: unknown };
    return { w: typeof saved.w === 'number' ? saved.w : undefined, h: typeof saved.h === 'number' ? saved.h : undefined };
  } catch {
    return {};
  }
}

function remember(sizes: { w?: number; h?: number }): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(sizes));
  } catch {
    // No storage: the size lasts until the page closes.
  }
}
