/**
 * Edit a TSX scene the way a person in an editor does — move a node, recolour a material, add or
 * remove an element — by splicing the text of exactly what changed. Everything else in the file,
 * comments and layout included, stays byte for byte.
 *
 * Reading is generous: a value is shown when it can be worked out without running anything —
 * literals, arithmetic, `Math.PI`, a constant of this file — and as a named reference otherwise
 * (`paint.grass`, a ref, a prefab). Writing is plain: the new value replaces the old text as a
 * literal, so a dragged `rotation={[-Math.PI / 2, 0, 0]}` comes back as numbers. That loss is the
 * price of a person's edit, and only of the attribute they touched.
 *
 * Elements are found by where they were written — the same line and column `jsxDEV` gives the
 * runtime (see `sourceOf`), so a picked object leads straight to its tag.
 */
import { parseSync } from 'rolldown/utils';

type Node = { type: string; start: number; end: number; [key: string]: unknown };

/** What an attribute holds, as far as reading it without running anything can tell. */
export type Value =
  | { kind: 'value'; value: unknown } // worked out: a number, string, list, object…
  | { kind: 'reference'; text: string }; // a name it cannot see through — shown and replaced, not edited inside

export interface Attribute {
  name: string;
  /** The whole attribute, `name={…}`, in the file. */
  start: number;
  end: number;
  /** Its value's text as written, or null for a bare flag (`castShadow`). */
  text: string | null;
  value: Value;
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

  const constants = new Map<string, unknown>();
  const evaluate = (node: Node): Value => {
    const seen = staticValue(node, constants);
    return seen === UNKNOWN ? { kind: 'reference', text: code.slice(node.start, node.end) } : { kind: 'value', value: seen };
  };

  // Constants of this file whose values can be worked out, so `position={[LANE, 0, 0]}` reads as numbers.
  for (const statement of program.body as Node[]) {
    const declaration = (statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement) as Node | null;
    if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue;
    for (const d of declaration.declarations as Node[]) {
      const id = d.id as Node;
      const init = d.init as Node | null;
      if (id.type === 'Identifier' && init) {
        const value = staticValue(init, constants);
        if (value !== UNKNOWN) constants.set(id.name as string, value);
      }
    }
  }

  const element = (node: Node): Element => {
    const opening = node.openingElement as Node;
    const selfClosing = opening.selfClosing === true;
    const attributes: Attribute[] = [];
    for (const attr of opening.attributes as Node[]) {
      if (attr.type !== 'JSXAttribute') continue;
      const name = code.slice((attr.name as Node).start, (attr.name as Node).end);
      const raw = attr.value as Node | null;
      if (!raw) {
        attributes.push({ name, start: attr.start, end: attr.end, text: null, value: { kind: 'value', value: true } });
        continue;
      }
      const inner = raw.type === 'JSXExpressionContainer' ? (raw.expression as Node) : raw;
      attributes.push({ name, start: attr.start, end: attr.end, text: code.slice(raw.start, raw.end), value: evaluate(inner) });
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

const UNKNOWN = Symbol('unknown');

/** A value worked out without running anything, or UNKNOWN. */
function staticValue(node: Node, constants: Map<string, unknown>): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'TemplateLiteral':
      return (node.expressions as Node[]).length ? UNKNOWN : ((node.quasis as Node[])[0]!.value as { cooked: string }).cooked;
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSNonNullExpression':
      return staticValue(node.expression as Node, constants);
    case 'Identifier':
      return constants.has(node.name as string) ? constants.get(node.name as string) : UNKNOWN;
    case 'UnaryExpression': {
      const v = staticValue(node.argument as Node, constants);
      if (typeof v !== 'number') return UNKNOWN;
      return node.operator === '-' ? -v : node.operator === '+' ? v : UNKNOWN;
    }
    case 'BinaryExpression': {
      const a = staticValue(node.left as Node, constants);
      const b = staticValue(node.right as Node, constants);
      if (typeof a !== 'number' || typeof b !== 'number') return UNKNOWN;
      switch (node.operator) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        default: return UNKNOWN;
      }
    }
    case 'MemberExpression': {
      const object = node.object as Node;
      const property = node.property as Node;
      if (!node.computed && object.type === 'Identifier' && object.name === 'Math' && property.type === 'Identifier') {
        const v = (Math as unknown as Record<string, unknown>)[property.name as string];
        return typeof v === 'number' ? v : UNKNOWN;
      }
      return UNKNOWN;
    }
    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const item of node.elements as Node[]) {
        const v = item ? staticValue(item, constants) : UNKNOWN;
        if (v === UNKNOWN) return UNKNOWN;
        out.push(v);
      }
      return out;
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const prop of node.properties as Node[]) {
        if (prop.type !== 'Property' || prop.computed) return UNKNOWN;
        const key = prop.key as Node;
        const v = staticValue(prop.value as Node, constants);
        if (v === UNKNOWN) return UNKNOWN;
        out[(key.name ?? key.value) as string] = v;
      }
      return out;
    }
    default:
      return UNKNOWN;
  }
}
