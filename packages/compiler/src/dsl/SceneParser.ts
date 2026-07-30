import { SaxesParser } from 'saxes';
import type { SncDiagnostic } from './diagnostics.js';

/**
 * A parsed XML element with its source position. This is the lightweight,
 * position-aware tree the validator and compiler walk — built on a streaming
 * SAX parser precisely so every node retains line/column (a DOMParser would
 * throw that away, breaking the grep/line-edit fix loop).
 */
export interface SncElement {
  tag: string;
  attributes: Map<string, string>;
  children: SncElement[];
  parent: SncElement | null;
  line: number;
  column: number;
  /** Set on elements spliced in from another file (prefab expansion). */
  file?: string;
  /** Set on a scene-level `<PrefabInstance>` root after expansion: the original `src=` value. */
  prefabSrc?: string;
}

export type SceneParseResult =
  | { ok: true; root: SncElement }
  | { ok: false; diagnostics: SncDiagnostic[] };

/**
 * Parse a scene XML string into a position-aware element tree. Returns XML
 * syntax errors (malformed markup) as diagnostics; semantic validation against
 * the schema is a separate pass (see Validator).
 */
export function parseScene(xml: string): SceneParseResult {
  const parser = new SaxesParser({ fileName: 'scene' });
  const diagnostics: SncDiagnostic[] = [];

  let root: SncElement | null = null;
  const stack: SncElement[] = [];

  parser.on('opentagstart', (tag) => {
    const el: SncElement = {
      tag: tag.name,
      attributes: new Map(),
      children: [],
      parent: stack[stack.length - 1] ?? null,
      // saxes columns are 0-based; present 1-based to match editor gutters.
      line: parser.line,
      column: parser.column + 1,
    };
    if (el.parent) el.parent.children.push(el);
    else root ??= el;
    stack.push(el);
  });

  parser.on('attribute', (attr) => {
    const top = stack[stack.length - 1];
    if (top) top.attributes.set(attr.name, attr.value);
  });

  parser.on('closetag', () => {
    stack.pop();
  });

  parser.on('error', (e) => {
    diagnostics.push({
      line: parser.line,
      column: parser.column + 1,
      code: 'xml-syntax',
      message: e.message,
    });
  });

  try {
    parser.write(xml).close();
  } catch {
    // saxes throws after emitting the 'error' event; the diagnostic is already recorded.
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  if (!root) {
    return {
      ok: false,
      diagnostics: [{ line: 1, column: 1, code: 'empty-document', message: 'No root element found' }],
    };
  }
  return { ok: true, root };
}
