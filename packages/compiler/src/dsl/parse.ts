import { SaxesParser } from 'saxes';
import type { SncDiagnostic } from './diagnostics.js';

/**
 * A parsed XML element with its source position. This is the lightweight,
 * position-aware tree the validator and the emitters walk — built on a streaming SAX parser
 * precisely so every node retains line/column (a DOMParser would throw that away, breaking
 * the grep/line-edit fix loop an agent depends on).
 */
export interface SncElement {
  tag: string;
  attributes: Map<string, string>;
  children: SncElement[];
  parent: SncElement | null;
  line: number;
  column: number;
  /** The document this element came from. */
  file?: string;
}

export type ParseResult =
  | { ok: true; root: SncElement }
  | { ok: false; diagnostics: SncDiagnostic[] };

/**
 * Parse a SceNoCo XML document into a position-aware element tree. Returns XML syntax errors
 * (malformed markup) as diagnostics; checking it against the scanned vocabulary is a separate
 * pass, because the vocabulary comes from the TypeScript program rather than from a schema
 * file this parser could hold.
 */
function truncate(text: string, max = 30): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function parseDocument(xml: string, file?: string): ParseResult {
  const parser = new SaxesParser({ fileName: file ?? 'document' });
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
      ...(file ? { file } : {}),
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

  // Text between tags is never meaningful in this DSL — every value is an attribute. Saying so
  // beats discarding it, because a document that put a value in the wrong place would otherwise
  // compile to something that silently lacks it.
  parser.on('text', (text) => {
    const trimmed = text.trim();
    const top = stack[stack.length - 1];
    if (trimmed.length === 0 || !top) return;
    diagnostics.push({
      line: parser.line,
      column: parser.column + 1,
      code: 'text-content',
      message:
        `<${top.tag}> contains the text "${truncate(trimmed)}". Every value in a SceNoCo ` +
        'document is an attribute; there is nothing that reads text between tags.',
      ...(file ? { file } : {}),
    });
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
