/**
 * Edit a TSX scene the way a person in an editor does — move a node, recolour a material, add or
 * remove an element — by splicing the text of exactly what changed. Everything else in the file,
 * comments and layout included, stays byte for byte.
 *
 * Reading gives each attribute's text as written; the values are the live objects'. Writing is
 * plain: the new value replaces the old text as a literal, so a dragged
 * `rotation={[-Math.PI / 2, 0, 0]}` comes back as numbers. That loss is the price of a person's
 * edit, and only of the attribute they touched.
 *
 * Elements are found by where they were written — the same line and column `jsxDEV` gives the
 * runtime (see `sourceOf`), so a picked object leads straight to its tag.
 */
import { parseSync } from 'rolldown/utils';

type Node = { type: string; start: number; end: number; [key: string]: unknown };

export interface Attribute {
  name: string;
  /** The whole attribute, `name={…}`, in the file. */
  start: number;
  end: number;
  /** Its value's text as written, or null for a bare flag (`castShadow`). */
  text: string | null;
  /** A list written out, `{[a, b, c]}`: each item's text, so one can be replaced and the rest kept as written. */
  items?: string[];
  /** Every name in the value — `terrains`, `meadow` in `{terrains.meadow}` — as offsets into the file. */
  names?: { start: number; end: number }[];
}

export interface Element {
  tag: string;
  /** 1-based, at the `<` — what `jsxDEV`'s source says. */
  line: number;
  column: number;
  start: number;
  end: number;
  /** Where a new attribute goes: just before `>` or `/>` of the opening tag. */
  attributesEnd: number;
  selfClosing: boolean;
  /** Start of `</Tag>`, where a new child goes; the element's end when self-closing. */
  closingStart: number;
  attributes: Attribute[];
  children: Element[];
}

export interface SceneDocument {
  code: string;
  /** Elements not inside another element: what each scene or prefab function returns. */
  roots: Element[];
}

export function readScene(file: string, code: string): SceneDocument {
  const { program, errors } = parseSync(file, code, { lang: 'tsx' }) as unknown as { program: Node; errors: { message: string }[] };
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
  const position = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo]! + 1 };
  };

  const element = (node: Node): Element => {
    const opening = node.openingElement as Node;
    const selfClosing = opening.selfClosing === true;
    const attributes: Attribute[] = [];
    for (const attr of opening.attributes as Node[]) {
      if (attr.type !== 'JSXAttribute') continue;
      const name = code.slice((attr.name as Node).start, (attr.name as Node).end);
      const raw = attr.value as Node | null;
      if (!raw) {
        attributes.push({ name, start: attr.start, end: attr.end, text: null });
        continue;
      }
      const inner = raw.type === 'JSXExpressionContainer' ? (raw.expression as Node) : raw;
      const list = inner.type === 'ArrayExpression' ? (inner.elements as (Node | null)[]) : null;
      const items = list && list.every((e) => e && e.type !== 'SpreadElement') ? list.map((e) => code.slice(e!.start, e!.end)) : undefined;
      const names = namesIn(inner);
      attributes.push({ name, start: attr.start, end: attr.end, text: code.slice(raw.start, raw.end), ...(items && { items }), ...(names.length && { names }) });
    }
    const children: Element[] = [];
    for (const child of node.children as Node[]) {
      if (child.type === 'JSXElement') children.push(element(child));
    }
    const closing = node.closingElement as Node | null;
    const at = position(node.start);
    return {
      tag: code.slice((opening.name as Node).start, (opening.name as Node).end),
      line: at.line,
      column: at.column,
      start: node.start,
      end: node.end,
      attributesEnd: code.lastIndexOf(selfClosing ? '/>' : '>', opening.end - 1),
      selfClosing,
      closingStart: closing ? closing.start : node.end,
      attributes,
      children,
    };
  };

  const roots: Element[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Node;
    if (n.type === 'JSXElement') return void roots.push(element(n));
    for (const [key, value] of Object.entries(n)) if (key !== 'start' && key !== 'end') visit(value);
  };
  visit(program);
  return { code, roots };
}

/**
 * The module's top-level constants and where each is written: what an element is inside of —
 * `Keep` for the elements of `export const Keep = prefab(() => …)`, whose function has no name.
 */
export function ownersOf(file: string, code: string): { name: string; start: number; end: number; exported: boolean }[] {
  const { program } = parseSync(file, code, { lang: 'tsx' }) as unknown as { program: Node };
  const out: { name: string; start: number; end: number; exported: boolean }[] = [];
  for (const statement of program.body as Node[]) {
    const exported = statement.type === 'ExportNamedDeclaration';
    const declaration = (exported ? statement.declaration : statement) as Node | null;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const d of declaration.declarations as Node[]) {
      const id = d.id as Node;
      if (id.type === 'Identifier') out.push({ name: id.name as string, start: d.start, end: d.end, exported });
    }
  }
  return out;
}

/** Every element of the document, depth first. */
export function elements(doc: SceneDocument): Element[] {
  const out: Element[] = [];
  const walk = (e: Element) => {
    out.push(e);
    e.children.forEach(walk);
  };
  doc.roots.forEach(walk);
  return out;
}

/** The element written at this line and column — `sourceOf(object)` of what it made. */
export function elementAt(doc: SceneDocument, line: number, column: number): Element | undefined {
  return elements(doc).find((e) => e.line === line && e.column === column);
}

/** Set an attribute to a value, replacing what was written or adding it at the end of the tag. */
export function setAttribute(code: string, element: Element, name: string, value: unknown): string {
  const existing = element.attributes.find((a) => a.name === name);
  return setAttributeText(code, element, name, value === true && existing?.text === null ? null : attributeText(value));
}

/** Set an attribute to text as written — `{-Math.PI / 2}`, `"red"` — or to a bare flag (null). */
export function setAttributeText(code: string, element: Element, name: string, text: string | null): string {
  const existing = element.attributes.find((a) => a.name === name);
  const written = text === null ? name : `${name}=${text}`;
  if (existing) return splice(code, existing.start, existing.end, written);
  const last = element.attributes.at(-1);
  if (last && code.slice(last.end, element.attributesEnd).includes('\n')) {
    // One attribute per line: a new line after the last one, indented like it.
    const lineStart = code.lastIndexOf('\n', last.start - 1) + 1;
    const indent = /^\s*/.exec(code.slice(lineStart, last.start))![0];
    return splice(code, last.end, last.end, `\n${indent}${written}`);
  }
  // On the tag's line: `<Group>` → `<Group a={1}>`, `<Mesh b />` → `<Mesh b a={1} />`.
  const spaced = /\s$/.test(code.slice(0, element.attributesEnd));
  return splice(code, element.attributesEnd, element.attributesEnd, spaced ? `${written} ` : ` ${written}`);
}

/**
 * `name` imported from `from`, if the file does not import it yet: added to the braces of an import
 * from that module already there, or as an import of its own after the last one.
 */
export function ensureImport(file: string, code: string, name: string, from: string): string {
  const { program } = parseSync(file, code, { lang: 'tsx' }) as unknown as { program: Node };
  const imports = (program.body as Node[]).filter((n) => n.type === 'ImportDeclaration');
  const named = (n: Node) => (n.specifiers as Node[]).filter((sp) => sp.type === 'ImportSpecifier');
  if (imports.some((n) => (n.specifiers as Node[]).some((sp) => (sp.local as Node).name === name))) return code;
  const same = imports.find((n) => (n.source as Node).value === from && n.importKind !== 'type' && named(n).length > 0);
  if (same) {
    const last = named(same).at(-1)!;
    return splice(code, last.end, last.end, `, ${name}`);
  }
  const after = imports.at(-1);
  const line = `import { ${name} } from ${JSON.stringify(from)};`;
  return after ? splice(code, after.end, after.end, `\n${line}`) : `${line}\n${code}`;
}

/** Remove an attribute, with the space before it. */
export function removeAttribute(code: string, element: Element, name: string): string {
  const existing = element.attributes.find((a) => a.name === name);
  if (!existing) return code;
  let start = existing.start;
  while (start > 0 && /[ \t]/.test(code[start - 1]!)) start--;
  if (code[start - 1] === '\n') {
    start = existing.start;
    while (start > 0 && code[start - 1] !== '\n') start--;
    return splice(code, start - 1, existing.end, '');
  }
  return splice(code, start, existing.end, '');
}

/** Remove an element; the whole line goes with it when it stood alone there. */
export function removeElement(code: string, element: Element): string {
  let start = element.start;
  let end = element.end;
  const lineStart = code.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = code.indexOf('\n', end);
  if (/^\s*$/.test(code.slice(lineStart, start)) && /^\s*$/.test(code.slice(end, lineEnd === -1 ? code.length : lineEnd))) {
    start = lineStart;
    end = lineEnd === -1 ? code.length : lineEnd + 1;
  }
  return splice(code, start, end, '');
}

/** Add a child at the end of an element, indented like its siblings. */
export function insertChild(code: string, parent: Element, tsx: string): string {
  const lineStart = code.lastIndexOf('\n', parent.start - 1) + 1;
  const indent = /^\s*/.exec(code.slice(lineStart, parent.start))![0];
  const inner = `${indent}  `;
  if (parent.selfClosing) {
    const open = code.slice(parent.start, parent.attributesEnd).replace(/\s+$/, '');
    return splice(code, parent.start, parent.end, `${open}>\n${inner}${tsx}\n${indent}</${parent.tag}>`);
  }
  const closingLineStart = code.lastIndexOf('\n', parent.closingStart - 1) + 1;
  const onOwnLine = /^\s*$/.test(code.slice(closingLineStart, parent.closingStart));
  return onOwnLine
    ? splice(code, closingLineStart, closingLineStart, `${inner}${tsx}\n`)
    : splice(code, parent.closingStart, parent.closingStart, `\n${inner}${tsx}\n${indent}`);
}

/** How a value is written as an attribute: `"…"` for a string, `{…}` for everything else. */
export function attributeText(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : `{${expressionText(value)}}`;
}

function expressionText(value: unknown): string {
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(expressionText).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${expressionText(v)}`);
    return `{ ${entries.join(', ')} }`;
  }
  throw new Error(`cannot write ${String(value)} into a scene`);
}

/** Four decimals at most — an editor's drag does not need more — and no `-0`. */
function numberText(n: number): string {
  const rounded = Math.round(n * 1e4) / 1e4;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function splice(code: string, start: number, end: number, text: string): string {
  return code.slice(0, start) + text + code.slice(end);
}

/** Every identifier under a node: the names a value refers to, and the members it reads off them. */
function namesIn(node: Node): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const n = value as Node;
    if (n.type === 'Identifier') out.push({ start: n.start, end: n.end });
    for (const [key, child] of Object.entries(n)) if (key !== 'start' && key !== 'end') visit(child);
  };
  visit(node);
  return out;
}
