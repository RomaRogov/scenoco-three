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

  /**
   * The element the last `</…>` popped, and the line it popped on.
   *
   * saxes pops *before* it complains — a `</PerspectivCamera>` closes the `<PerspectiveCamera>`
   * that was open and only then reports that the names do not match — so by the time the error
   * arrives the tag worth naming is off the stack. This is where it goes.
   */
  let closed: { element: SncElement; line: number } | undefined;

  parser.on('closetag', () => {
    const element = stack.pop();
    if (element) closed = { element, line: parser.line };
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
      // A fence is the one stray text worth naming outright. It is what a model writing this
      // file leaves behind when it wraps its answer in markdown, it is by far the most common
      // way a generated document fails to parse, and the fix — delete the line — has nothing
      // to do with the attribute rule the general message explains.
      message: isFence(trimmed)
        ? `<${top.tag}> contains "${truncate(trimmed)}", which looks like a markdown code ` +
          'fence. Delete the line: a document holds XML and nothing else.'
        : `<${top.tag}> contains the text "${truncate(trimmed)}". Every value in a SceNoCo ` +
          'document is an attribute; there is nothing that reads text between tags.' +
          // `<curve>0 1; 1 0</curve>` inside `<SizeOverLifetime>`: an attribute written as a child.
          // Elements are type names and start upper-case, so a lower-case one is a field.
          (/^[a-z]/.test(top.tag) && stack.length > 1
            ? ` Write it on <${stack[stack.length - 2]!.tag}> as ${top.tag}="…".`
            : ''),
      ...(file ? { file } : {}),
    });
  });

  /** The element that was still open when each syntax error happened. */
  const openAt: Array<SncElement | undefined> = [];

  parser.on('error', (e) => {
    openAt[diagnostics.length] =
      closed && closed.line === parser.line ? closed.element : stack[stack.length - 1];
    diagnostics.push({
      line: parser.line,
      column: parser.column + 1,
      code: 'xml-syntax',
      // saxes puts `file:line:column:` in front of its own message, and the diagnostic already
      // carries all three — printed as they were, the position appeared twice on the line.
      message: e.message.replace(/^.*?:\d+:\d+:\s*/, ''),
      ...(file ? { file } : {}),
    });
  });

  try {
    parser.write(xml).close();
  } catch {
    // saxes throws after emitting the 'error' event; the diagnostic is already recorded.
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics: firstSyntaxError(xml, diagnostics, openAt, file) };
  if (!root) {
    return {
      ok: false,
      diagnostics: [{ line: 1, column: 1, code: 'empty-document', message: 'No root element found' }],
    };
  }
  return { ok: true, root };
}

/**
 * Everything up to and including the first syntax error, said once and said usefully.
 *
 * A parser that cannot make sense of the markup cannot make sense of what follows it either, so
 * every error after the first is a guess about a document that no longer exists — six copies of
 * "documents may contain only one root" for one missing `>`. saxes also reports some of them
 * twice, and words two common ones in terms of what it was doing rather than what is on the page:
 * a bare `&` is "unexpected end" at the end of the file, and a mismatched close tag says nothing
 * about the tag it was supposed to match. Both are rewritten here, at the character responsible.
 */
function firstSyntaxError(
  xml: string,
  diagnostics: readonly SncDiagnostic[],
  openAt: ReadonlyArray<SncElement | undefined>,
  file?: string,
): SncDiagnostic[] {
  const first = diagnostics.findIndex((d) => d.code === 'xml-syntax');
  if (first === -1) return [...diagnostics];
  // saxes says "unexpected close tag" and then, at the same spot, names the tag. Both describe
  // one mistake, so the one that names something wins.
  const here = diagnostics.filter((d, i) => i >= first && d.line === diagnostics[first]!.line && d.column === diagnostics[first]!.column);
  const named = here.find((d) => d.message.startsWith('unmatched closing tag:')) ?? here[0]!;
  return [...diagnostics.slice(0, first), explained(xml, named, openAt[first], file)];
}

/** One saxes complaint, in terms of what is on the page and what to write instead. */
function explained(
  xml: string,
  diagnostic: SncDiagnostic,
  open: SncElement | undefined,
  file?: string,
): SncDiagnostic {
  const at = (line: number, column: number, message: string): SncDiagnostic => ({
    line,
    column,
    code: 'xml-syntax',
    message,
    ...(file ? { file } : {}),
  });

  // `</PerspectivCamera>` against a `<PerspectiveCamera>` that is still open. What saxes cannot
  // say is which tag the document was actually inside, which is the whole of the answer.
  const unmatched = /^unmatched closing tag: (.+?)\.?$/.exec(diagnostic.message);
  const closing = unmatched?.[1] ?? closeTagBefore(xml, diagnostic.line, diagnostic.column);
  if (closing && open && /closing tag|close tag/.test(diagnostic.message)) {
    return at(
      diagnostic.line,
      diagnostic.column,
      `</${closing}> closes nothing: the tag still open here is <${open.tag}>, from line ${open.line}. ` +
        `Close that one first, or correct the name.`,
    );
  }

  // A bare `&` is read as the start of an entity, so the parser runs to the end of the file
  // before giving up — and reports the end of the file, which is nowhere near the `&`.
  if (/unexpected end|unclosed tag/.test(diagnostic.message)) {
    const stray = positionOf(xml, /&(?!#?[A-Za-z0-9]+;)/);
    if (stray) return at(stray.line, stray.column, 'An "&" on its own is not XML. Write "&amp;".');
  }

  if (diagnostic.message.startsWith('disallowed character')) {
    // saxes reports the position *after* the character it refused.
    const character = characterAt(xml, diagnostic.line, diagnostic.column - 1);
    if (character === '<') {
      return at(diagnostic.line, diagnostic.column, 'A "<" inside a value starts a tag. Write "&lt;".');
    }
  }
  return diagnostic;
}

/** The name in the `</Name>` that ends at or just before a 1-based line and column. */
function closeTagBefore(xml: string, line: number, column: number): string | undefined {
  const text = xml.split('\n')[line - 1]?.slice(0, column) ?? '';
  return /<\/\s*([^\s/>]+)\s*>?\s*$/.exec(text)?.[1];
}

/** Where the first match of `pattern` is, as a 1-based line and column. */
function positionOf(xml: string, pattern: RegExp): { line: number; column: number } | undefined {
  const found = pattern.exec(xml);
  if (!found) return undefined;
  const before = xml.slice(0, found.index);
  const line = before.split('\n').length;
  return { line, column: found.index - (before.lastIndexOf('\n') + 1) + 1 };
}

/** The character a 1-based line and column names. */
function characterAt(xml: string, line: number, column: number): string | undefined {
  const lines = xml.split('\n');
  return lines[line - 1]?.[column - 1];
}

/** ```, ```xml, ~~~ — a fence, with or without its language tag. */
function isFence(text: string): boolean {
  return /^(```|~~~)[a-z]*$/i.test(text);
}

function truncate(text: string, max = 30): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
