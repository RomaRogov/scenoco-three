/**
 * The page beside the panel. The panel takes a side of the screen rather than covering the game: a
 * column on the right, or the lower half of a phone held upright. Beside it the page's body is
 * narrowed, and the game lays itself out in what is left. Above it there is too little height for a
 * layout made for a tall screen, so the page is scaled down into the space at its full height:
 * playing, in its own shape, centred, as it will be played; paused, widened to fill the space, for
 * the editor's own camera.
 */
import type { EditHost } from '@scenoco-three/core';

/** Fit the page to the panel `element`, now and as the window, the panel or the game changes; and how to stop. */
export function fitPage(host: EditHost, element: HTMLElement): () => void {
  const body = document.body;
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
  const stopGrip = grip(element, fit);
  const refit = () => {
    applySizes();
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
  return () => {
    removeEventListener('resize', refit);
    cancelAnimationFrame(watching);
    settled.disconnect();
    stopGrip();
  };
}

// --- the panel's size, dragged by its inner edge: its width beside the game, its height under it ---

const SIZE_KEY = 'scenoco-editor-size';
const sizes = remembered();

/** What was chosen is kept; what fits the window now is what shows. */
function fits(side: 'w' | 'h', px: number): number {
  return Math.round(Math.max(side === 'w' ? 260 : 180, Math.min(px, side === 'w' ? innerWidth - 160 : innerHeight - 120)));
}

function applySizes(): void {
  for (const side of ['w', 'h'] as const) {
    const px = sizes[side];
    if (px) document.documentElement.style.setProperty(`--se-${side}`, `${fits(side, px)}px`);
  }
}

/** The grip on the panel's inner edge; `fit` lays the page out again as it moves. */
function grip(element: HTMLElement, fit: () => void): () => void {
  applySizes();
  const handle = document.createElement('div');
  handle.className = 'se-grip';
  handle.title = 'Drag to resize';
  element.appendChild(handle);
  handle.addEventListener('pointerdown', (event) => {
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      if (innerHeight > innerWidth) sizes.h = fits('h', innerHeight - e.clientY);
      else sizes.w = fits('w', innerWidth - e.clientX);
      applySizes();
      fit();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      remember(sizes);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  return () => {
    document.documentElement.style.removeProperty('--se-w');
    document.documentElement.style.removeProperty('--se-h');
  };
}

/** The panel's last width and height, in pixels: this browser's, for every project it edits. */
function remembered(): { w?: number; h?: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? '{}') as { w?: unknown; h?: unknown };
    return { w: typeof saved.w === 'number' ? saved.w : undefined, h: typeof saved.h === 'number' ? saved.h : undefined };
  } catch {
    return {};
  }
}

function remember(chosen: { w?: number; h?: number }): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(chosen));
  } catch {
    // No storage: the size lasts until the page closes.
  }
}
