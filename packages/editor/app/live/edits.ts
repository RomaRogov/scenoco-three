/**
 * Apply a save to the document text — the compiler's own splices, run in the page.
 *
 * The standalone editor has no server to send edits to, and a second implementation of "put
 * this attribute here" is the one thing guaranteed to drift from the compiler's positions. So
 * the compiler's own edit functions are reached through its browser entry, and this is the one
 * loop over them.
 */
import { indexDocument, insertChild, moveElement, removeElement, setAttribute, type ElementAt } from '@scenoco-three/compiler/browser';
import type { Edit } from '../document.js';

/** An attribute no document writes, carried by each targeted element while the edits land. */
const MARK = 'scenoco-edit-target';

/**
 * Every edit names its element by where it stood in the text **as opened** — the positions the
 * live objects were stamped with. The first splice moves everything after it, so the edits are
 * not applied by position. Each element an edit names is first marked with an attribute, the
 * marks are what the edits find, and they are taken back out at the end.
 *
 * Marking runs from the end of the file backwards, so adding one mark never moves an element
 * still waiting for its own. A moved element keeps its mark, because a move lifts the text as it
 * is; a removed one takes its mark with it, and an edit that still names it is reported.
 */
export function applyEdits(source: string, edits: readonly Edit[]): { text: string; problems: string[] } {
  const problems: string[] = [];
  const opened = indexDocument(source);
  const marks = new Map<string, string>(); // "line:column" → mark
  const key = (at: ElementAt): string => `${at.line}:${at.column}`;
  for (const edit of edits) {
    for (const at of edit.op === 'moveElement' ? [edit.at, edit.parent] : [edit.at]) {
      if (!marks.has(key(at))) marks.set(key(at), String(marks.size));
    }
  }

  let text = source;
  const targets = opened.filter((e) => marks.has(key(e))).sort((a, b) => b.start - a.start);
  for (const element of targets) text = setAttribute(text, element, MARK, marks.get(key(element))!).text;

  /** Where the element an edit named stands now, or the position as given when it was never marked. */
  const now = (at: ElementAt): ElementAt => {
    const mark = marks.get(key(at));
    const found = mark === undefined ? undefined : indexDocument(text).find((e) => e.attributes[MARK] === mark);
    return found ?? { line: -1, column: -1 };
  };

  for (const edit of edits) {
    const result =
      edit.op === 'setAttribute'
        ? setAttribute(text, now(edit.at), edit.name, edit.value)
        : edit.op === 'removeElement'
          ? removeElement(text, now(edit.at))
          : edit.op === 'insertChild'
            ? insertChild(text, now(edit.at), edit.xml, edit.index)
            : moveElement(text, now(edit.at), now(edit.parent), edit.index);
    if (result.problem) problems.push(result.problem.replace('-1:-1', `${edit.at.line}:${edit.at.column}`));
    text = result.text;
  }

  for (const element of indexDocument(text).filter((e) => e.attributes[MARK] !== undefined).sort((a, b) => b.start - a.start)) {
    text = setAttribute(text, element, MARK, null).text;
  }
  return { text, problems };
}
