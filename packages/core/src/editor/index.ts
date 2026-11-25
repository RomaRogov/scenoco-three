import type { EditorPort } from '@scenoco/kernel';
import { sizeCanvas } from './page.js';
import { openViewport } from './viewport.js';

/** three.js's half of the editor: its viewport, and the canvas sized while the editor lays the page out. */
export const threeEditor: EditorPort = {
  openViewport,
  sizeView: (view, host) => sizeCanvas(view.renderer, host),
};
