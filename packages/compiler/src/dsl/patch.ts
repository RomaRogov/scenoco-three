import { SaxesParser } from 'saxes';
import {
  Registry,
  TRANSFORM_ATTRS,
  ValueType,
  getAttachmentDef,
  getNodeDef,
  isScalarType,
  isEnumType,
  valueEquals,
  type EnumDef,
} from '@scenoco-three/core/internal';
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
 * Edits are addressed by `id` first (ids survive structural file edits); id-less
 * nodes fall back to the structural `path`/`nodePath` — ordinals among node-kind
 * child elements from the root, with `tag` verified so a stale path lands in
 * `unresolved` rather than on the wrong element. Component edits are the Nth
 * `<Type>` in the owning node's `<Components>`. Edits that can't be located are
 * returned in `unresolved`.
 */

export type PatchTarget =
  | { kind: 'node'; id?: string; path?: number[]; tag?: string }
  | { kind: 'component'; nodeId?: string; nodePath?: number[]; type: string; ordinal: number }
  | { kind: 'attachment'; nodeId?: string; nodePath?: number[]; root?: boolean; tag: string; ordinal: number };

export interface PatchEdit {
  target: PatchTarget;
  attr: string;
  /**
   * The new compiled value, or **`null` to remove the attribute** from the source.
   * Removal is explicit rather than inferred: an optional attribute with no
   * registry default (`backgroundColor?: number`) has no value that could stand
   * for "absent", so clearing it has to be its own instruction.
   */
  value: number | boolean | string | number[] | null;
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

export function patchSceneXml(xml: string, edits: PatchEdit[]): PatchResult {
  const { all, roots } = scan(xml);

  // One attribute op per (element, attr); group by element so each start tag is
  // rewritten once even when several of its attributes change.
  const byElement = new Map<El, Map<string, string | null>>(); // value text, or null = remove
  const unresolved: PatchEdit[] = [];

  for (const edit of edits) {
    const el = locate(all, roots, edit.target);
    // An explicit removal needs no codec — there is no value to serialize, and the
    // attribute may have no registry entry to resolve a type from.
    if (edit.value === null) {
      if (!el) {
        unresolved.push(edit);
        continue;
      }
      let removeOps = byElement.get(el);
      if (!removeOps) byElement.set(el, (removeOps = new Map()));
      removeOps.set(edit.attr, null);
      continue;
    }
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
  if (target.kind === 'node') return locateNode(all, roots, target.id, target.path, target.tag);
  if (target.kind === 'attachment') {
    // Attachments live in the node's <Attachments> block (the scene root when `root`).
    const owner = target.root ? roots[0] : locateNode(all, roots, target.nodeId, target.nodePath);
    const block = owner?.children.find((c) => c.tag === 'Attachments');
    const matches = block?.children.filter((c) => c.tag === target.tag) ?? [];
    return matches[target.ordinal];
  }
  const node = locateNode(all, roots, target.nodeId, target.nodePath);
  const components = node?.children.find((c) => c.tag === 'Components');
  const matches = components?.children.filter((c) => c.tag === target.type) ?? [];
  return matches[target.ordinal];
}

/** A node element, by `id` first, else by structural path (ordinals among node-kind children from the root). */
function locateNode(all: El[], roots: El[], id?: string, path?: number[], tag?: string): El | undefined {
  if (id) return all.find((e) => e.id === id);
  if (!path) return undefined;
  // Path anchor = the compiled root's source element: <Scene> itself, or the one
  // spatial node inside a prefab file's <Prefab> wrapper.
  const doc = roots[0];
  let el = doc && (isNodeEl(doc) ? doc : doc.children.find(isNodeEl));
  for (const ordinal of path) {
    if (!el) return undefined;
    el = el.children.filter(isNodeEl)[ordinal];
  }
  if (!el) return undefined;
  // Verify the tag when carried: a mismatch means the file changed on disk since
  // the edit was made — unresolved, not a patch of the wrong element. A source
  // <PrefabInstance> compiles to its prefab root's tag, so it matches any.
  if (tag && el.tag !== tag && el.tag !== 'PrefabInstance') return undefined;
  return el;
}

/** Whether a scanned element is a scene node (vs. an attachment / <Components> block). */
function isNodeEl(e: El): boolean {
  return e.tag === 'PrefabInstance' || getNodeDef(e.tag) !== undefined;
}

/** The codec type + default for an edit's attribute (transform/registry/attachment; `src` is a plain string). */
function resolve(edit: PatchEdit): { type: ScalarType | EnumDef; default?: number | boolean | string | number[] } | undefined {
  const t = edit.target;
  // `id` and `src` are plain string attributes with no registry default (never elided).
  if (t.kind === 'node') {
    if (edit.attr === 'src' || edit.attr === 'id') return { type: ValueType.String };
    // Transform attrs come from the registry, never a local copy — `scale` is a
    // `scale`-typed vec3 (identity 1), and a second table here would silently
    // serialize it as a plain vec3 and stop eliding its 1s.
    const transform = TRANSFORM_ATTRS[edit.attr];
    if (transform && isScalarType(transform.type)) {
      return {
        type: transform.type,
        ...(transform.default !== undefined ? { default: transform.default as number | boolean | string | number[] } : {}),
      };
    }
    // Not a transform attr → the node tag's own attribute (`<PerspectiveCamera fov>`),
    // typed by the node registry exactly as attachment and component attrs are.
    const meta = t.tag ? getNodeDef(t.tag)?.attrs[edit.attr] : undefined;
    if (!meta || (!isScalarType(meta.type) && !isEnumType(meta.type))) return undefined;
    return { type: meta.type, ...(meta.default !== undefined ? { default: meta.default as number | boolean | string | number[] } : {}) };
  }
  if (t.kind === 'component') {
    const meta = Registry.getComponent(t.type)?.meta.properties.get(edit.attr);
    if (!meta || (!isScalarType(meta.type) && !isEnumType(meta.type))) return undefined;
    return { type: meta.type, ...(meta.default !== undefined ? { default: meta.default as number | boolean | string | number[] } : {}) };
  }
  // attachment
  if (edit.attr === 'src') return { type: ValueType.String };
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
