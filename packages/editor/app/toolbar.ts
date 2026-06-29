import type { GizmoMode } from './gizmo.js';

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
  /** Current state, polled on each `refresh`. */
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

export interface Toolbar {
  /** Re-read handler state into the button styles (transport, active mode, enabled, dirty dot). */
  refresh(): void;
}

// Material-style 24×24 icon paths (filled, `currentColor`).
const ICON = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  step: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  stop: 'M6 6h12v12H6z',
  move: 'M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H8l4 4 4-4h-3v-3z',
  rotate:
    'M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z',
  scale:
    'M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  redo: 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
  save: 'M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z',
} as const;

/**
 * Two floating, touch-reachable toolbars: a **play** panel (play/pause/step/stop)
 * and a **movement** panel (gizmo mode, undo/redo, save). The movement panel is
 * hidden in play mode — there's no editing while the sim runs. All actions defer
 * to `handlers`, which read the live session/document/gizmo.
 */
export function buildToolbar(handlers: ToolbarHandlers): Toolbar {
  const bars = el('div', 'sc-toolbars');
  const playBar = el('div', 'sc-toolbar');
  const editBar = el('div', 'sc-toolbar');

  const play = btn('Play', ICON.play, () => handlers.play());
  const pause = btn('Pause', ICON.pause, () => handlers.pause());
  const step = btn('Step one frame', ICON.step, () => handlers.step());
  const stop = btn('Stop', ICON.stop, () => handlers.stop());
  playBar.append(play, pause, step, stop);

  const move = modeBtn('translate', 'Move', ICON.move);
  const rotate = modeBtn('rotate', 'Rotate', ICON.rotate);
  const scale = modeBtn('scale', 'Scale', ICON.scale);
  const undo = btn('Undo', ICON.undo, () => handlers.undo());
  const redo = btn('Redo', ICON.redo, () => handlers.redo());
  const save = btn('Save', ICON.save, () => handlers.save());
  save.classList.add('sc-save');
  editBar.append(move, rotate, scale, sep(), undo, redo, sep(), save);

  bars.append(playBar, editBar);
  document.body.append(bars);

  function modeBtn(mode: GizmoMode, title: string, path: string): HTMLButtonElement {
    return btn(title, path, () => handlers.setMode(mode), mode);
  }

  function refresh(): void {
    const s = handlers.state();
    const editing = s.mode === 'edit';
    const paused = s.mode === 'play' && !s.playing;

    // Transport.
    play.disabled = s.playing; // edit → start; paused → resume; playing → disabled
    play.classList.toggle('active', s.playing);
    pause.disabled = !s.playing;
    step.disabled = !paused;
    stop.disabled = editing;

    // Movement panel: editing only happens in edit mode — hide it during play.
    editBar.style.display = editing ? '' : 'none';

    const mode = handlers.getMode();
    for (const b of [move, rotate, scale]) {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.disabled = !s.enabled;
    }
    undo.disabled = !s.canUndo;
    redo.disabled = !s.canRedo;
    save.disabled = !s.dirty || s.saving;
    save.classList.toggle('dirty', s.dirty);
    save.classList.toggle('saving', s.saving);
  }

  refresh();
  return { refresh };
}

// ── DOM helpers ──────────────────────────────────────────────────────────────────

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
function btn(title: string, iconPath: string, onClick: () => void, mode?: GizmoMode): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'sc-tbtn';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${iconPath}"/></svg>`;
  if (mode) b.dataset.mode = mode;
  b.onclick = onClick;
  return b;
}
function sep(): HTMLElement {
  return el('div', 'sc-tsep');
}
