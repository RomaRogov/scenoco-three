import { parse } from '@xml-tools/parser';
import { buildAst } from '@xml-tools/ast';
import { getNodeDef } from '@scenoco-three/core/internal';

/**
 * Structural, comment-preserving XML editing — the counterpart to `patchSceneXml`
 * (which does attribute-level edits). Given the *original* source and an ordered
 * op-log, it moves / removes / inserts whole node elements by **splicing the
 * original text**: untouched (and moved) subtrees are copied byte-for-byte, so all
 * comments and formatting outside the touched region survive exactly as authored.
 *
 * Built on `@xml-tools/parser` (a Chevrotain CST with byte-accurate element/token
 * positions) — see `apply.test.ts`. A node is addressed by `id` first (ids survive
 * reshaping); an id-less node falls back to the structural `path` (ordinals among
 * node-kind children from the root), with `tag` verified. Ops whose target/parent
 * can't be resolved are returned in `unresolved`, never applied to the wrong node.
 *
 * Ops are applied one at a time (re-parsing between each) so offsets never go
 * stale — scenes are small and a drag produces few ops, so this stays cheap and
 * keeps the logic obvious.
 */

/** Addresses a node element: by `id`, else by structural `path` (`[]` = the root). */
export interface NodeRef {
  id?: string;
  /** Ordinals among node-kind children from the root; `[]` targets the root itself. */
  path?: number[];
  /** Verified against a path-located element (a stale path resolves to unresolved). */
  tag?: string;
}

/**
 * Addresses a component or attachment element — a child of a node's `<Components>`
 * or `<Attachments>` block, picked by tag + ordinal among same-tag siblings (the
 * same addressing `patchSceneXml` uses for their attributes).
 */
export interface MemberRef {
  node: NodeRef;
  block: 'Components' | 'Attachments';
  tag: string;
  /** Ordinal among same-tag siblings in that block. */
  ordinal: number;
}

export type StructuralOp =
  | { op: 'moveNode'; target: NodeRef; parent: NodeRef; index?: number }
  | { op: 'removeNode'; target: NodeRef }
  | { op: 'insertNode'; parent: NodeRef; index?: number; xml: string }
  | { op: 'removeMember'; target: MemberRef }
  /** Reorder within the member's own block; `index` is among *all* the block's children. */
  | { op: 'moveMember'; target: MemberRef; index: number }
  /**
   * Add a component/attachment element. `xml` is the element source (e.g.
   * `<Rotator speed="2" />`). The block is created when the node has none yet,
   * placed in the serializer's canonical order: `<Attachments>`, `<Components>`,
   * then child nodes.
   */
  | { op: 'insertMember'; node: NodeRef; block: 'Components' | 'Attachments'; xml: string; index?: number };

export interface ApplyResult {
  text: string;
  /** How many ops were applied (spliced the source). */
  applied: number;
  /** Ops whose target / parent element could not be resolved. */
  unresolved: StructuralOp[];
}

/** Apply an ordered structural op-log to `xml`, preserving comments/formatting. */
export function applyStructuralOps(xml: string, ops: StructuralOp[]): ApplyResult {
  let text = xml;
  let applied = 0;
  const unresolved: StructuralOp[] = [];
  for (const op of ops) {
    const next = applyOne(text, op);
    if (next === null) unresolved.push(op);
    else {
      text = next;
      applied++;
    }
  }
  return { text, applied, unresolved };
}

// ── the lossless element view (positions from @xml-tools) ────────────────────────

interface Pos {
  startOffset: number;
  endOffset: number;
}
interface El {
  name: string;
  position: Pos;
  attributes: { key: string | null; value: string | null; position: Pos }[];
  subElements: El[];
}
interface Tok {
  image: string;
  startOffset: number;
  endOffset: number;
  tokenType: { name: string };
}
interface Doc {
  xml: string;
  root: El;
  tokens: Tok[];
}

function index(xml: string): Doc | null {
  const { cst, tokenVector, lexErrors, parseErrors } = parse(xml);
  if (lexErrors.length || parseErrors.length) return null;
  const root = buildAst(cst as never, tokenVector as never).rootElement as unknown as El;
  return { xml, root, tokens: tokenVector as unknown as Tok[] };
}

const TRIVIA = new Set(['SEA_WS', 'Comment']);
const attrId = (el: El): string | undefined => el.attributes.find((a) => a.key === 'id')?.value ?? undefined;
/** A scene node element (vs. a `<Components>` / `<Attachments>` block or a leaf attr). */
const isNodeEl = (name: string): boolean => name === 'PrefabInstance' || getNodeDef(name) !== undefined;
const nodeKids = (el: El): El[] => el.subElements.filter((c) => isNodeEl(c.name));

/** Resolve a NodeRef to its element: `id` first, else the structural `path` from the root. */
function resolveNode(doc: Doc, ref: NodeRef): El | null {
  if (ref.id !== undefined) {
    let found: El | null = null;
    (function walk(el: El) {
      if (attrId(el) === ref.id) found = el;
      for (const c of el.subElements) walk(c);
    })(doc.root);
    return found;
  }
  if (!ref.path) return null;
  // Path anchor = the compiled root's node: <Scene> itself, or the one node inside a
  // prefab file's <Prefab> wrapper.
  let el: El | undefined = isNodeEl(doc.root.name) ? doc.root : doc.root.subElements.find((c) => isNodeEl(c.name));
  for (const ordinal of ref.path) {
    if (!el) return null;
    el = nodeKids(el)[ordinal];
  }
  if (!el) return null;
  if (ref.tag && el.name !== ref.tag && el.name !== 'PrefabInstance') return null;
  return el;
}

// ── text geometry helpers ────────────────────────────────────────────────────────

/** The leading whitespace on the line `offset` sits on (its indentation). */
function lineIndent(xml: string, offset: number): string {
  const start = xml.lastIndexOf('\n', offset - 1) + 1;
  const line = xml.slice(start, offset);
  return /^\s*/.exec(line)![0];
}

/** The token index whose start is exactly `offset` (an element's opening `<`). */
const tokenAt = (doc: Doc, offset: number): number => doc.tokens.findIndex((t) => t.startOffset === offset);

/**
 * The removable range for an element: the element plus the run of whitespace/
 * comments directly above it (so a node's own banner comment is removed/moved with
 * it), and the byte offset where its *comments* begin (blank separators excluded).
 */
function leading(doc: Doc, el: El): { removeStart: number; commentStart: number } {
  const i = tokenAt(doc, el.position.startOffset);
  if (i < 0) return { removeStart: el.position.startOffset, commentStart: el.position.startOffset };
  let j = i - 1;
  while (j >= 0 && TRIVIA.has(doc.tokens[j]!.tokenType.name)) j--;
  const removeStart = doc.tokens[j + 1]!.startOffset;
  const firstComment = doc.tokens.slice(j + 1, i).find((t) => t.tokenType.name === 'Comment');
  return { removeStart, commentStart: firstComment ? firstComment.startOffset : el.position.startOffset };
}

/** The document's indent step (indentation of the first top-level node). */
function indentUnit(doc: Doc): string {
  const first = nodeKids(doc.root)[0];
  return first ? lineIndent(doc.xml, first.position.startOffset) : '  ';
}

/** The indentation a child of `parent` should have. */
function childIndent(doc: Doc, parent: El): string {
  const kid = nodeKids(parent)[0];
  if (kid) return lineIndent(doc.xml, kid.position.startOffset);
  return lineIndent(doc.xml, parent.position.startOffset) + indentUnit(doc);
}

/** Shift a block's base indentation from `from` to `to` (relative nesting preserved). */
const reindent = (block: string, from: string, to: string): string =>
  from === to ? block : block.split('\n' + from).join('\n' + to);

/**
 * Locate `parent`'s start-tag boundary: the offset just after `>` for a normal
 * element (where children go), or the `/` of a self-closing `<X ... />` (which the
 * caller expands into `<X ...>…</X>` to gain a child slot).
 */
function openTag(xml: string, parent: El): { selfClose: boolean; mark: number } | null {
  let quote = '';
  for (let i = parent.position.startOffset; i <= parent.position.endOffset; i++) {
    const c = xml[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '/' && xml[i + 1] === '>') return { selfClose: true, mark: i }; // the '/'
    else if (c === '>') return { selfClose: false, mark: i + 1 }; // just past '>'
  }
  return null;
}

/** Resolve a MemberRef to its element inside the node's `<Components>`/`<Attachments>` block. */
function resolveMember(doc: Doc, ref: MemberRef): { el: El; block: El } | null {
  const node = resolveNode(doc, ref.node);
  if (!node) return null;
  const block = node.subElements.find((c) => c.name === ref.block);
  if (!block) return null;
  const el = block.subElements.filter((c) => c.name === ref.tag)[ref.ordinal];
  return el ? { el, block } : null;
}

/**
 * Remove an element and re-insert it at `index` among its parent's children —
 * used for reordering a component/attachment within its block. Both edits are
 * computed against the original text and applied right-to-left, so the second
 * splice never sees offsets invalidated by the first.
 */
function reorderWithin(doc: Doc, parent: El, el: El, index: number): string | null {
  const xml = doc.xml;
  const kids = parent.subElements;
  const from = kids.indexOf(el);
  if (from < 0 || index === from) return null; // not found, or already there
  const { removeStart, commentStart } = leading(doc, el);
  const block = xml.slice(commentStart, el.position.endOffset + 1);
  const indent = lineIndent(xml, el.position.startOffset);

  // Insert before the child that will occupy `index`; past the end → after the last.
  // `index` counts positions in the *current* order, so a downward move targets the
  // child after the one being displaced.
  const others = kids.filter((k) => k !== el);
  const at = index < others.length ? others[index]! : null;
  const offset = at ? leading(doc, at).removeStart : others.length ? others[others.length - 1]!.position.endOffset + 1 : null;
  if (offset === null) return null;

  const edits = [
    { start: removeStart, end: el.position.endOffset + 1, text: '' },
    { start: offset, end: offset, text: `\n${indent}${block}` },
  ].sort((a, b) => b.start - a.start);
  return edits.reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), xml);
}

// ── the node + member ops ────────────────────────────────────────────────────────

function applyOne(xml: string, op: StructuralOp): string | null {
  const doc = index(xml);
  if (!doc) return null;

  if (op.op === 'removeMember') {
    const found = resolveMember(doc, op.target);
    if (!found) return null;
    const { removeStart } = leading(doc, found.el);
    return xml.slice(0, removeStart) + xml.slice(found.el.position.endOffset + 1);
  }

  if (op.op === 'moveMember') {
    const found = resolveMember(doc, op.target);
    if (!found) return null;
    return reorderWithin(doc, found.block, found.el, op.index);
  }

  if (op.op === 'insertMember') {
    const host = resolveNode(doc, op.node);
    if (!host) return null;
    const member = op.xml.trim();
    const existing = host.subElements.find((c) => c.name === op.block);

    if (existing) {
      const slot = openTag(xml, existing);
      if (!slot) return null;
      const kids = existing.subElements;
      const inner = kids[0]
        ? lineIndent(xml, kids[0].position.startOffset)
        : lineIndent(xml, existing.position.startOffset) + indentUnit(doc);
      const text = reindent(member, lineIndent(member, 0), inner);
      if (slot.selfClose) {
        // `<Components />` → `<Components>…</Components>` to gain a child slot.
        const pad = lineIndent(xml, existing.position.startOffset);
        let ws = slot.mark;
        while (ws > 0 && /\s/.test(xml[ws - 1]!)) ws--;
        return xml.slice(0, ws) + `>\n${inner}${text}\n${pad}</${existing.name}>` + xml.slice(slot.mark + 2);
      }
      const at = op.index !== undefined && op.index < kids.length ? kids[op.index]! : null;
      const off = at
        ? leading(doc, at).removeStart
        : kids.length
          ? kids[kids.length - 1]!.position.endOffset + 1
          : slot.mark;
      return xml.slice(0, off) + `\n${inner}${text}` + xml.slice(off);
    }

    // No such block yet — create it around the member.
    const slot = openTag(xml, host);
    if (!slot) return null;
    const pad = lineIndent(xml, host.position.startOffset);
    const inner = pad + indentUnit(doc);
    const block = [`<${op.block}>`, `${indentUnit(doc)}${reindent(member, lineIndent(member, 0), '')}`, `</${op.block}>`]
      .map((line, i) => (i === 0 ? line : inner + line))
      .join('\n');
    if (slot.selfClose) {
      let ws = slot.mark;
      while (ws > 0 && /\s/.test(xml[ws - 1]!)) ws--;
      return xml.slice(0, ws) + `>\n${inner}${block}\n${pad}</${host.name}>` + xml.slice(slot.mark + 2);
    }
    // Canonical order: <Attachments> before <Components> before child nodes.
    const attachments = host.subElements.find((c) => c.name === 'Attachments');
    const anchor =
      op.block === 'Components' && attachments
        ? attachments.position.endOffset + 1
        : host.subElements.length
          ? leading(doc, host.subElements[0]!).removeStart
          : slot.mark;
    return xml.slice(0, anchor) + `\n${inner}${block}` + xml.slice(anchor);
  }

  if (op.op === 'removeNode') {
    const el = resolveNode(doc, op.target);
    if (!el) return null;
    const { removeStart } = leading(doc, el);
    return xml.slice(0, removeStart) + xml.slice(el.position.endOffset + 1);
  }

  // move + insert both compute a child block to place under `parent`.
  const parent = resolveNode(doc, op.parent);
  if (!parent) return null;
  const slot = openTag(xml, parent);
  if (!slot) return null;

  const toIndent = childIndent(doc, parent);
  let block: string;
  let cut: { start: number; end: number } | null = null;

  if (op.op === 'insertNode') {
    block = reindent(op.xml.trim(), lineIndent(op.xml, 0), toIndent);
  } else {
    const el = resolveNode(doc, op.target);
    if (!el) return null;
    if (el === parent || contains(el, parent)) return null; // can't move a node into itself/descendant
    const { removeStart, commentStart } = leading(doc, el);
    const fromIndent = lineIndent(xml, el.position.startOffset);
    block = reindent(xml.slice(commentStart, el.position.endOffset + 1), fromIndent, toIndent);
    cut = { start: removeStart, end: el.position.endOffset + 1 };
  }

  const edits: { start: number; end: number; text: string }[] = [];
  if (slot.selfClose) {
    // Expand `<X ... />` → `<X ...>\n  <block>\n</X>` to create a child slot.
    const parentIndent = lineIndent(xml, parent.position.startOffset);
    let wsStart = slot.mark;
    while (wsStart > 0 && /\s/.test(xml[wsStart - 1]!)) wsStart--; // trim the space before `/>`
    edits.push({ start: wsStart, end: slot.mark + 2, text: `>\n${toIndent}${block}\n${parentIndent}</${parent.name}>` });
  } else {
    // Insert before the child currently at `index`, else after the last child.
    const kids = nodeKids(parent);
    const at = op.index !== undefined && op.index < kids.length ? kids[op.index]! : null;
    const offset = at ? leading(doc, at).removeStart : kids.length ? kids[kids.length - 1]!.position.endOffset + 1 : slot.mark;
    edits.push({ start: offset, end: offset, text: `\n${toIndent}${block}` });
  }
  if (cut) edits.push({ start: cut.start, end: cut.end, text: '' });
  // Apply right-to-left so the earlier splice keeps later offsets valid.
  edits.sort((a, b) => b.start - a.start);
  return edits.reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), xml);
}

/** Whether `maybeDescendant` is `el` or nested inside it. */
function contains(el: El, maybeDescendant: El): boolean {
  if (el === maybeDescendant) return true;
  return el.subElements.some((c) => contains(c, maybeDescendant));
}
