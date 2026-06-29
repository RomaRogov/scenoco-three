import { SaxesParser } from 'saxes';
import { Registry, getAttachmentDef, isScalarType, isEnumType, valueEquals, type EnumDef } from '@scenoco-three/core/internal';
import { scalarCodec, type ScalarType } from './types.js';

/**
 * Surgical, attribute-level XML editing — the inverse of a full re-serialize.
 * Given the *original* source and a set of edits addressed by element `id`, it
 * rewrites **only** the touched attributes inside their start tags and leaves
 * every other byte (prefab instances, `src=` refs, comments, formatting) exactly
 * as authored. The result is a minimal diff, suitable for writing back to disk.
 *
 * An attribute whose new value equals the registry default is **removed**,
 * matching the canonical serializer's default-elision so files stay clean.
 *
 * Edits are addressed by `id` (which survives prefab expansion, unlike structural
 * paths); component edits are `nodeId` → the Nth `<Type>` in that node's
 * `<Components>`. Edits that can't be located are returned in `unresolved`.
 */

export type PatchTarget =
  | { kind: 'node'; id?: string }
  | { kind: 'component'; nodeId?: string; type: string; ordinal: number }
  | { kind: 'attachment'; nodeId?: string; root?: boolean; tag: string; ordinal: number };

export interface PatchEdit {
  target: PatchTarget;
  attr: string;
  value: number | boolean | string | number[];
}

export interface PatchResult {
  text: string;
  /** Number of elements whose start tag changed. */
  changed: number;
  /** Edits whose target element / attribute type could not be resolved. */
  unresolved: PatchEdit[];
}

interface El {
  tag: string;
  id?: string;
  openStart: number; // index of '<'
  openEnd: number; // index just after the start tag's '>'
  children: El[];
}

/** Transform attributes the editor sets directly on a node, with their codec + default. */
const TRANSFORM: Record<string, { type: ScalarType; default: number | boolean | number[] }> = {
  position: { type: 'vec3', default: [0, 0, 0] },
  rotation: { type: 'euler', default: [0, 0, 0] },
  scale: { type: 'vec3', default: [1, 1, 1] },
  visible: { type: 'bool', default: true },
};

export function patchSceneXml(xml: string, edits: PatchEdit[]): PatchResult {
  const { all, roots } = scan(xml);

  // One attribute op per (element, attr); group by element so each start tag is
  // rewritten once even when several of its attributes change.
  const byElement = new Map<El, Map<string, string | null>>(); // value text, or null = remove
  const unresolved: PatchEdit[] = [];

  for (const edit of edits) {
    const el = locate(all, roots, edit.target);
    const codec = resolve(edit);
    if (!el || !codec) {
      unresolved.push(edit);
      continue;
    }
    let ops = byElement.get(el);
    if (!ops) byElement.set(el, (ops = new Map()));
    const removed = codec.default !== undefined && valueEquals(edit.value, codec.default);
    ops.set(edit.attr, removed ? null : scalarCodec(codec.type).serialize(edit.value));
  }

  // Apply right-to-left so earlier offsets stay valid as we splice.
  const elements = [...byElement.keys()].sort((a, b) => b.openStart - a.openStart);
  let text = xml;
  let changed = 0;
  for (const el of elements) {
    const orig = xml.slice(el.openStart, el.openEnd);
    const next = applyAttrs(orig, byElement.get(el)!);
    if (next !== orig) {
      text = text.slice(0, el.openStart) + next + text.slice(el.openEnd);
      changed++;
    }
  }
  return { text, changed, unresolved };
}

// ── element scan (saxes for correct nesting; spans computed for byte-exact edits) ──

function scan(xml: string): { all: El[]; roots: El[] } {
  const parser = new SaxesParser();
  const all: El[] = [];
  const roots: El[] = [];
  const stack: El[] = [];
  parser.on('opentagstart', (t) => {
    const openStart = xml.lastIndexOf('<', parser.position);
    const el: El = { tag: t.name, openStart, openEnd: startTagEnd(xml, openStart), children: [] };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else roots.push(el);
    stack.push(el);
    all.push(el);
  });
  parser.on('attribute', (a) => {
    if (a.name === 'id') stack[stack.length - 1]!.id = a.value;
  });
  parser.on('closetag', () => void stack.pop());
  try {
    parser.write(xml).close();
  } catch {
    /* malformed XML — caller validates separately; we patch what parsed */
  }
  return { all, roots };
}

/** Scan forward from a tag's '<' to the '>' that ends its start tag (quote-aware). */
function startTagEnd(xml: string, from: number): number {
  let quote = '';
  for (let i = from; i < xml.length; i++) {
    const c = xml[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return xml.length;
}

function locate(all: El[], roots: El[], target: PatchTarget): El | undefined {
  if (target.kind === 'node') return target.id ? all.find((e) => e.id === target.id) : undefined;
  if (target.kind === 'attachment') {
    // Attachments are direct children of their node (the scene root when `root`).
    const owner = target.root ? roots[0] : target.nodeId ? all.find((e) => e.id === target.nodeId) : undefined;
    const matches = owner?.children.filter((c) => c.tag === target.tag) ?? [];
    return matches[target.ordinal];
  }
  if (!target.nodeId) return undefined;
  const node = all.find((e) => e.id === target.nodeId);
  const components = node?.children.find((c) => c.tag === 'Components');
  const matches = components?.children.filter((c) => c.tag === target.type) ?? [];
  return matches[target.ordinal];
}

/** The codec type + default for an edit's attribute (transform/registry/attachment; `src` is a plain string). */
function resolve(edit: PatchEdit): { type: ScalarType | EnumDef; default?: number | boolean | string | number[] } | undefined {
  const t = edit.target;
  if (t.kind === 'node') return edit.attr === 'src' ? { type: 'string' } : TRANSFORM[edit.attr];
  if (t.kind === 'component') {
    const meta = Registry.getComponent(t.type)?.meta.properties.get(edit.attr);
    if (!meta || (!isScalarType(meta.type) && !isEnumType(meta.type))) return undefined;
    return { type: meta.type, ...(meta.default !== undefined ? { default: meta.default as number | boolean | string | number[] } : {}) };
  }
  // attachment
  if (edit.attr === 'src') return { type: 'string' };
  const meta = getAttachmentDef(t.tag)?.attrs[edit.attr];
  if (!meta || (!isScalarType(meta.type) && !isEnumType(meta.type))) return undefined;
  return { type: meta.type, ...(meta.default !== undefined ? { default: meta.default as number | boolean | string | number[] } : {}) };
}

// ── start-tag attribute surgery ─────────────────────────────────────────────────

function applyAttrs(tagText: string, ops: Map<string, string | null>): string {
  let s = tagText;
  for (const [name, value] of ops) {
    // Capture the leading whitespace so a value change keeps the source's alignment.
    const re = new RegExp(`(\\s+)${escapeRe(name)}\\s*=\\s*"[^"]*"`);
    if (value === null) {
      s = s.replace(re, '');
    } else if (re.test(s)) {
      s = s.replace(re, `$1${name}="${escapeXml(value)}"`);
    } else {
      s = insertAttr(s, `${name}="${escapeXml(value)}"`);
    }
  }
  return s;
}

/** Insert an attribute just before the start tag's `>` or `/>`. */
function insertAttr(tagText: string, attr: string): string {
  const m = tagText.match(/\s*\/?>\s*$/);
  if (!m) return tagText;
  const selfClose = m[0].includes('/');
  const head = tagText.slice(0, tagText.length - m[0].length).replace(/\s+$/, '');
  return `${head} ${attr}${selfClose ? ' />' : '>'}`;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
