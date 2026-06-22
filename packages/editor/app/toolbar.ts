import type { GizmoMode } from './gizmo.js';

export interface ToolbarHandlers {
  getMode(): GizmoMode;
  setMode(mode: GizmoMode): void;
  undo(): void;
  redo(): void;
  save(): void;
  /** Current enabled/dirty state, polled on each `refresh`. */
  state(): { canUndo: boolean; canRedo: boolean; dirty: boolean; saving: boolean; enabled: boolean };
}

export interface Toolbar {
  /** Re-read handler state into the button styles (active mode, enabled, dirty dot). */
  refresh(): void;
}

/**
 * A compact, touch-reachable toolbar: gizmo mode (move/rotate/scale), undo/redo,
 * and Save with an unsaved-changes dot. All actions defer to `handlers`, which
 * read the live document/gizmo (both are recreated on every scene swap).
 */
export function buildToolbar(handlers: ToolbarHandlers): Toolbar {
  const bar = el('div', 'sc-toolbar');

  const move = modeBtn('translate', 'Move', '✥');
  const rotate = modeBtn('rotate', 'Rotate', '⟳');
  const scale = modeBtn('scale', 'Scale', '⤢');
  const undo = btn('Undo', '↶', () => handlers.undo());
  const redo = btn('Redo', '↷', () => handlers.redo());
  const save = btn('Save', 'Save', () => handlers.save());
  save.classList.add('sc-save');

  bar.append(move, rotate, scale, sep(), undo, redo, sep(), save);
  document.body.append(bar);

  function modeBtn(mode: GizmoMode, title: string, glyph: string): HTMLButtonElement {
    return btn(title, glyph, () => handlers.setMode(mode), mode);
  }

  function refresh(): void {
    const s = handlers.state();
    const mode = handlers.getMode();
    for (const b of [move, rotate, scale]) b.classList.toggle('active', b.dataset.mode === mode);
    for (const b of [move, rotate, scale]) b.disabled = !s.enabled;
    undo.disabled = !s.canUndo;
    redo.disabled = !s.canRedo;
    save.disabled = !s.dirty || s.saving;
    save.classList.toggle('dirty', s.dirty);
    save.textContent = s.saving ? 'Saving…' : 'Save';
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
function btn(title: string, label: string, onClick: () => void, mode?: GizmoMode): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'sc-tbtn';
  b.title = title;
  b.textContent = label;
  if (mode) b.dataset.mode = mode;
  b.onclick = onClick;
  return b;
}
function sep(): HTMLElement {
  return el('div', 'sc-tsep');
}
