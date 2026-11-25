/** @jsxImportSource react */
/**
 * A value shown, not edited, as the file writes it: each name in it a link — a reference to the node
 * it refers to, anything else to where it is declared.
 */
import type { Object3D } from 'three';
import type { EditHost } from '@scenoco-three/core';
import { codeOf, type Attr, type Model, type TextLink } from '../model/Model.js';

/**
 * A value shown, not edited, as written: each name in it a link — to the node it refers to, for a
 * reference (`target={player}`, each item of `[a, b]`), and otherwise to where it is declared (a prefab).
 */
export function Shown({ model, attr }: { model: Model; attr: Attr }): React.JSX.Element {
  const text = shownText(attr);
  // The links are places in the file's text: only that text has them.
  const links = attr.written && attr.text === text ? [...(attr.links ?? [])].sort((a, b) => a.from - b.from) : [];
  if (!links.length) return <span className="se-text">{text}</span>;
  const nodeAt = sceneTargets(model.host, attr, text);
  const parts: React.ReactNode[] = [];
  let at = 0;
  links.forEach((link: TextLink, i) => {
    if (link.from < at) return;
    parts.push(text.slice(at, link.from));
    const name = text.slice(link.from, link.to);
    const node = nodeAt(link.from);
    parts.push(
      node ? (
        <a key={i} className="se-ref se-scene" href="#" title={`${model.tagName(node)} in the scene — select it (declared at ${link.where.label})`} onClick={(event) => (event.preventDefault(), model.host.select(node))}>
          {name}
        </a>
      ) : (
        <a key={i} className="se-ref" href="#" title={`${link.where.label} — open in your code editor`} onClick={(event) => (event.preventDefault(), void model.open(link.where))}>
          {name}
        </a>
      ),
    );
    at = link.to;
  });
  parts.push(text.slice(at));
  return <span className="se-text">{parts}</span>;
}

/**
 * Which node a name at a place in an attribute's text refers to, live: the attribute's own value
 * when it is one — a node, or a behaviour on one — or, in a list written in place, its item's.
 */
function sceneTargets(host: EditHost, attr: Attr, text: string): (at: number) => Object3D | null {
  const nodeOf = (value: unknown): Object3D | null => {
    if (host.isNode(value)) return value;
    const node = (value as { node?: unknown } | null)?.node;
    return host.isNode(node) ? node : null;
  };
  const whole = nodeOf(attr.value);
  if (whole) return () => whole;
  if (!Array.isArray(attr.value) || !attr.items || attr.items.length !== attr.value.length) return () => null;
  // Each item's place in the text, in order.
  const spans: [number, number][] = [];
  let from = text.indexOf('[') + 1;
  for (const item of attr.items) {
    const start = text.indexOf(item, from);
    spans.push([start, start + item.length]);
    from = start + item.length;
  }
  const list = attr.value as unknown[];
  return (at) => {
    const index = spans.findIndex(([start, end]) => at >= start && at < end);
    return index < 0 ? null : nodeOf(list[index]);
  };
}

/** A value shown, not edited: its text in the file when written, else the live value. */
function shownText(attr: Attr): string {
  if (attr.written && attr.text !== null) return attr.text;
  const value = codeOf(attr.value);
  return typeof attr.value === 'string' ? value : `{${value}}`;
}
