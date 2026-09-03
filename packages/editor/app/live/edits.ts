/**
 * Apply a save to the document text — the same splices the server applies, run in the page.
 *
 * The standalone editor has no server to send edits to, and a second implementation of "put
 * this attribute here" is the one thing guaranteed to drift from the compiler's positions. So
 * the compiler's own edit functions are reached through its browser entry, and this is the one
 * loop over them, identical to the server's.
 */
import { insertChild, moveElement, removeElement, setAttribute } from '@scenoco-three/compiler/browser';
import type { Edit } from '../document.js';

export function applyEdits(source: string, edits: readonly Edit[]): { text: string; problems: string[] } {
  let text = source;
  const problems: string[] = [];
  for (const edit of edits) {
    const result =
      edit.op === 'setAttribute'
        ? setAttribute(text, edit.at, edit.name, edit.value)
        : edit.op === 'removeElement'
          ? removeElement(text, edit.at)
          : edit.op === 'insertChild'
            ? insertChild(text, edit.at, edit.xml, edit.index)
            : moveElement(text, edit.at, edit.parent, edit.index);
    if (result.problem) problems.push(result.problem);
    text = result.text;
  }
  return { text, problems };
}
