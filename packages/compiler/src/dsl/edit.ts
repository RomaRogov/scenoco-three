import { SaxesParser } from 'saxes';

/**
 * Editing a document **as text**, so everything nobody touched survives byte for byte.
 *
 * The alternative — parse to a tree, change it, serialize it back — rewrites the whole file on
 * every edit: comments move or vanish, attribute order normalises, indentation becomes the
 * serializer's opinion, and a one-attribute change lands as a hundred-line diff. XML is the
 * source of truth here and a person reads it, so an edit has to be a splice.
 *
 * ### Addressing
 *
 * An element is addressed by the **line and column its open tag ends at** — exactly the pair the
 * compiler stamps into `userData.scenoco`. So a live `Object3D` under the cursor names an element
 * with no lookup table, no ids required, and no structural path to go stale: both sides run the
 * same parser over the same bytes and get the same numbers.
 *
 * v1 addressed edits by `id`, falling back to an ordinal path among sibling elements, with a
 * whole `unresolved` channel for the times that missed. None of that is needed.
 */

/** One element, and where every part of it sits in the source. */
export interface ElementRange {
  tag: string;
  /** 1-based, where the open tag *ends* — the identity the compiler stamps. */
  line: number;
  column: number;
  /** Offset of the `<` that opens it. */
  start: number;
  /** Offset just past the `>` that closes the open tag. */
  openEnd: number;
  /** Offset just past the end of the whole element. */
  end: number;
  selfClosing: boolean;
  /** The attributes as written, unescaped. */
  attributes: Record<string, string>;
  parent: ElementRange | null;
  children: ElementRange[];
}

/** An element's position, as provenance records it. */
export interface ElementAt {
  line: number;
  column: number;
}

export interface EditResult {
  text: string;
  /** False when the edit resolved to nothing and the text is unchanged. */
  changed: boolean;
  /** What went wrong, if anything. */
  problem?: string;
}

/**
 * Every element in the document, with its ranges.
 *
 * Throws on malformed XML — an editor should never be splicing a file it could not parse, and
 * silently returning an empty index would turn that into a lost edit.
 */
export function indexDocument(xml: string): ElementRange[] {
  const all: ElementRange[] = [];
  const stack: ElementRange[] = [];
  const parser = new SaxesParser({ position: true });
  let failure: string | undefined;
  /** Where the *name* ended — see `opentagstart` below. */
  let nameEnd: { line: number; column: number } = { line: 1, column: 1 };

  parser.on('error', (error) => {
    failure ??= error.message;
  });

  // The identity is recorded here, just past the tag name, because that is where the **document
  // parser** records it — and its numbers are what the compiler stamped into the live objects.
  // Taking the position at `opentag` instead put a long open tag tens of columns later, and
  // every node with one silently failed to match its element.
  parser.on('opentagstart', () => {
    nameEnd = { line: parser.line, column: parser.column + 1 };
  });

  parser.on('opentag', (tag) => {
    // `position` is just past the `>`. The `<` is the nearest one before it, and it cannot be
    // ambiguous: `<` is not legal inside an attribute value.
    const openEnd = parser.position;
    const start = xml.lastIndexOf('<', openEnd - 1);
    const element: ElementRange = {
      tag: tag.name,
      line: nameEnd.line,
      column: nameEnd.column,
      start,
      openEnd,
      end: openEnd, // corrected on close
      selfClosing: tag.isSelfClosing,
      attributes: Object.fromEntries(
        Object.entries(tag.attributes).map(([name, value]) => [name, String(value)]),
      ),
      parent: stack[stack.length - 1] ?? null,
      children: [],
    };
    element.parent?.children.push(element);
    all.push(element);
    stack.push(element);
  });

  parser.on('closetag', () => {
    const element = stack.pop();
    if (element) element.end = parser.position;
  });

  parser.write(xml).close();
  if (failure) throw new Error(`[scenoco] cannot edit a document that does not parse: ${failure}`);
  return all;
}

/** The element at a position, or undefined. */
export function elementAt(elements: readonly ElementRange[], at: ElementAt): ElementRange | undefined {
  return elements.find((e) => e.line === at.line && e.column === at.column);
}

/**
 * Set, replace or remove one attribute, touching nothing else in the file.
 *
 * `null` removes it. Removal is its own instruction rather than "set to the default", because an
 * attribute with no default has no value that could stand for absent.
 */
export function setAttribute(
  xml: string,
  at: ElementAt,
  name: string,
  value: string | null,
): EditResult {
  const element = elementAt(indexDocument(xml), at);
  if (!element) return { text: xml, changed: false, problem: missing(at) };

  const openTag = xml.slice(element.start, element.openEnd);
  const found = findAttribute(openTag, name);

  if (found) {
    if (value === null) {
      // Take the whitespace before it too, or removing an attribute leaves a double space.
      const from = element.start + leadingSpace(openTag, found.start);
      return spliced(xml, from, element.start + found.end, '');
    }
    return spliced(xml, element.start + found.valueStart, element.start + found.valueEnd, escapeValue(value));
  }

  if (value === null) return { text: xml, changed: false };

  // New attribute: after the last existing one, so authored order is preserved and a diff shows
  // one added attribute rather than a reordered tag.
  const insertAt = element.start + endOfAttributes(openTag);
  return spliced(xml, insertAt, insertAt, ` ${name}="${escapeValue(value)}"`);
}

/**
 * Remove an element and everything under it.
 *
 * Takes the whitespace and indentation on its line with it, so deleting the only child of a
 * block does not leave a blank line where it was.
 */
export function removeElement(xml: string, at: ElementAt): EditResult {
  const element = elementAt(indexDocument(xml), at);
  if (!element) return { text: xml, changed: false, problem: missing(at) };
  const { from, to } = withSurroundingWhitespace(xml, element);
  return spliced(xml, from, to, '');
}

/**
 * Insert `fragment` as a child of the element at `parent`.
 *
 * `index` is the position among the parent's existing element children; past the end, or
 * omitted, appends. The fragment is re-indented to sit level with its new siblings, because an
 * editor's job is to produce a file a person would have written.
 */
export function insertChild(
  xml: string,
  parent: ElementAt,
  fragment: string,
  index?: number,
): EditResult {
  const element = elementAt(indexDocument(xml), parent);
  if (!element) return { text: xml, changed: false, problem: missing(parent) };

  const indent = indentOf(xml, element) + '  ';
  const body = reindent(fragment.trim(), indent);

  if (element.selfClosing) {
    // `<Group />` has nowhere to put a child, so it becomes `<Group>…</Group>`.
    const openTag = xml.slice(element.start, element.openEnd);
    const opened = `${openTag.replace(/\s*\/>$/, '>')}\n${indent}${body}\n${indentOf(xml, element)}</${element.tag}>`;
    return spliced(xml, element.start, element.end, opened);
  }

  const insertAt = childOffset(xml, element, index);
  return spliced(xml, insertAt, insertAt, `\n${indent}${body}`);
}

/**
 * Where a new child's text begins, as an offset in `xml`.
 *
 * Appending goes at the **end of the last child**, not just before the closing tag: the newline
 * and indentation already sitting in front of `</Scene>` belong to that close tag, and splicing
 * ahead of them would put the new element on the close tag's line.
 */
function childOffset(xml: string, parent: ElementRange, index?: number): number {
  const siblings = parent.children;
  if (index !== undefined && index < siblings.length) {
    return withSurroundingWhitespace(xml, siblings[index]!).from;
  }
  const last = siblings[siblings.length - 1];
  return last ? last.end : parent.openEnd;
}

/**
 * Move an element under a new parent — the reparent a drag in the tree produces.
 *
 * Lifted verbatim from the source rather than re-serialized, so the moved subtree keeps its
 * comments and its own formatting, and only its outer indentation changes.
 */
export function moveElement(
  xml: string,
  at: ElementAt,
  newParent: ElementAt,
  index?: number,
): EditResult {
  const elements = indexDocument(xml);
  const element = elementAt(elements, at);
  const parent = elementAt(elements, newParent);
  if (!element) return { text: xml, changed: false, problem: missing(at) };
  if (!parent) return { text: xml, changed: false, problem: missing(newParent) };
  if (contains(element, parent)) {
    return { text: xml, changed: false, problem: 'cannot move an element inside itself' };
  }

  if (parent.selfClosing) {
    // Two splices would overlap the same element, so let `insertChild` open the parent up first
    // and re-address the move against the result. The parent keeps its position: nothing above
    // it moved.
    const opened = insertChild(xml, newParent, xml.slice(element.start, element.end), index);
    return opened.changed ? removeElement(opened.text, at) : opened;
  }

  const indent = indentOf(xml, parent) + '  ';
  const insert = `\n${indent}${reindent(xml.slice(element.start, element.end), indent)}`;

  // Both edits are computed against the *original* text and then applied back to front, so
  // neither invalidates the other's offsets. Doing them in sequence is what made a move land one
  // element off — the second edit addressed a document the first had already shifted.
  const removal = withSurroundingWhitespace(xml, element);
  return applySplices(xml, [
    { from: removal.from, to: removal.to, insert: '' },
    { from: childOffset(xml, parent, index), to: childOffset(xml, parent, index), insert },
  ]);
}

/** Apply edits back to front, so an earlier one never moves a later one's offsets. */
function applySplices(xml: string, splices: Array<{ from: number; to: number; insert: string }>): EditResult {
  let text = xml;
  for (const splice of [...splices].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, splice.from) + splice.insert + text.slice(splice.to);
  }
  return { text, changed: text !== xml };
}

// --- the small print ------------------------------------------------------------------------

interface AttributeSpan {
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
}

/**
 * Locate one attribute inside an open tag.
 *
 * Scanned rather than regex-matched across the file: the slice is known to be exactly one open
 * tag, so `>` inside an attribute value — which XML allows — cannot confuse it.
 */
function findAttribute(openTag: string, name: string): AttributeSpan | undefined {
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*')/g;
  for (let match = pattern.exec(openTag); match; match = pattern.exec(openTag)) {
    if (match[1] !== name) continue;
    const start = match.index;
    const end = start + match[0].length;
    const quoted = match[2]!;
    return { start, end, valueStart: end - quoted.length + 1, valueEnd: end - 1 };
  }
  return undefined;
}

/** Where a new attribute goes: after the last one, before `/>` or `>`. */
function endOfAttributes(openTag: string): number {
  const close = /\s*\/?>$/.exec(openTag);
  return close ? close.index : openTag.length - 1;
}

function leadingSpace(text: string, from: number): number {
  let i = from;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  return i;
}

/** An element plus the whitespace that would be orphaned by removing it. */
function withSurroundingWhitespace(xml: string, element: ElementRange): { from: number; to: number } {
  let from = element.start;
  while (from > 0 && (xml[from - 1] === ' ' || xml[from - 1] === '\t')) from--;
  if (from > 0 && xml[from - 1] === '\n') from--;
  return { from, to: element.end };
}

/** The indentation of the line the element starts on. */
function indentOf(xml: string, element: ElementRange): string {
  const lineStart = xml.lastIndexOf('\n', element.start - 1) + 1;
  return /^[ \t]*/.exec(xml.slice(lineStart, element.start))![0];
}

/** Put a fragment on `indent`, keeping its own internal shape. */
function reindent(fragment: string, indent: string): string {
  const lines = fragment.split('\n');
  const base = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => /^[ \t]*/.exec(l)![0].length);
  const strip = base.length > 0 ? Math.min(...base) : 0;
  return lines
    .map((line, i) => (i === 0 ? line : line.trim() ? indent + line.slice(strip) : ''))
    .join('\n');
}

function contains(ancestor: ElementRange, node: ElementRange): boolean {
  for (let current: ElementRange | null = node; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function spliced(xml: string, from: number, to: number, insert: string): EditResult {
  const text = xml.slice(0, from) + insert + xml.slice(to);
  return { text, changed: text !== xml };
}

function escapeValue(value: string): string {
  // `>` is legal in an attribute value, but escaping only one of the pair produces text that is
  // correct and looks broken. Both, always.
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function missing(at: ElementAt): string {
  return `no element at ${at.line}:${at.column} — the document changed since it was read`;
}
