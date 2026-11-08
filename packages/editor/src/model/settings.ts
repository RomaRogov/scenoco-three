/** What this browser keeps for the editor, for every project it edits: chosen in the settings. */
import type { Reach } from '@scenoco-three/core';
import type { CodeEditor } from './types.js';

const CODE_EDITOR_KEY = 'scenoco-editor-code';
const REACH_KEY = 'scenoco-editor-reset';
const REACHES: readonly Reach[] = ['none', 'awake', 'onEnable', 'start', 'frame'];

/** How source links open. */
export function codeEditor(): CodeEditor {
  try {
    const saved = localStorage.getItem(CODE_EDITOR_KEY);
    if (saved === 'auto' || saved === 'system' || saved === 'custom' || saved === 'vscode' || saved === 'cursor') return saved;
  } catch {
    // no storage: the default
  }
  return 'auto';
}

export function setCodeEditor(how: CodeEditor): void {
  try {
    localStorage.setItem(CODE_EDITOR_KEY, how);
  } catch {
    // no storage: it lasts as long as nothing asks again
  }
}

/** How far Reset lets behaviours go before it holds the scene. */
export function resetReach(): Reach {
  try {
    const saved = localStorage.getItem(REACH_KEY) as Reach | null;
    if (saved && REACHES.includes(saved)) return saved;
  } catch {
    // no storage: the default
  }
  return 'frame';
}

export function setResetReach(reach: Reach): void {
  try {
    localStorage.setItem(REACH_KEY, reach);
  } catch {
    // no storage: it lasts as long as nothing asks again
  }
}
