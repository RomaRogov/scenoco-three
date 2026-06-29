import type { Color, Euler, Object3D, Vector2, Vector3 } from 'three';
import {
  Registry,
  elementType,
  getAttachmentDef,
  isArrayType,
  isEnumType,
  isScalarType,
  type Component,
  type EnumDef,
  type Engine,
  type NodeAttr,
  type PropertyMeta,
} from '@scenoco-three/core';
import type { AttachmentView, SceneDocument } from './document.js';

export interface Panels {
  /** Re-read the scene into the tree + inspector. */
  refresh(): void;
  /** Select a node from outside (e.g. a viewport pick) — syncs tree + inspector. */
  select(node: Object3D | null): void;
}

/**
 * The editor's two side panels: a left **Hierarchy** (collapsible scene tree) and
 * a right **Inspector** that *edits* the selected node's transform and component
 * `@property` values. Every edit goes through the active `SceneDocument`, so it is
 * undoable and savable. Geometry/material (pooled, shared) and reference/array
 * props are shown read-only for now. `onSelect` lets the host highlight the node.
 */
export function buildPanels(
  getEngine: () => Engine,
  getDoc: () => SceneDocument | undefined,
  onSelect: (node: Object3D | null) => void,
): Panels {
  const tree = div('sc-tree');
  const inspector = div('sc-inspector');
  document.body.append(drawer('left', 'Hierarchy', tree), drawer('right', 'Inspector', inspector));

  const engine = () => getEngine();
  let selected: Object3D | null = null;
  const collapsedNodes = new Set<Object3D>(); // hierarchy fold state
  const closedSections = new Set<string>(); // inspector section fold state

  function select(node: Object3D | null): void {
    selected = node;
    onSelect(node);
    renderTree();
    renderInspector();
  }

  // ── hierarchy ──────────────────────────────────────────────────────────────────

  function renderTree(): void {
    tree.replaceChildren();
    // <Scene> is the root row, so its own attachments (Background/Fog) are selectable.
    tree.append(treeRow(engine().scene, 0));
  }

  function treeRow(node: Object3D, depth: number): HTMLElement {
    const wrap = div('');
    const row = div('sc-node' + (node === selected ? ' sel' : ''));
    row.style.paddingLeft = `${6 + depth * 14}px`;
    const children = node.children.filter((c) => !isEditorOnly(c)); // hide gizmo/helper/preview objects
    const open = !collapsedNodes.has(node);
    const caret = div('sc-caret', children.length > 0 ? (open ? '▾' : '▸') : '');
    if (children.length > 0) {
      caret.onclick = (e) => {
        e.stopPropagation();
        if (open) collapsedNodes.add(node);
        else collapsedNodes.delete(node);
        renderTree();
      };
    }
    row.append(caret, nodeLabel(node));
    row.onclick = () => select(node);
    wrap.append(row);
    if (open) for (const child of children) wrap.append(treeRow(child, depth + 1));
    return wrap;
  }

  // ── inspector ──────────────────────────────────────────────────────────────────

  function renderInspector(): void {
    inspector.replaceChildren();
    if (!selected) {
      inspector.append(div('sc-empty', 'Select a node — tap it in the viewport or the hierarchy.'));
      return;
    }
    const node = selected;
    const doc = getDoc();

    const head = div('');
    head.append(div('sc-sec sc-sec-plain', typeName(node)));
    if (node.name) head.append(row('id', node.name));
    inspector.append(head);

    // A prefab instance: its `src` is editable (swap the prefab); content below is read-only.
    const prefabSrc = doc?.prefabSrc(node);
    if (prefabSrc !== undefined) {
      inspector.append(
        sectionBlock('Prefab', [editRow('src', textField(() => prefabSrc, (v) => doc?.setNodeSrc(node, v)))]),
      );
    }

    // Transform — editable on authored nodes + prefab roots; read-only inside a prefab.
    if (node !== engine().scene) {
      const editT = doc?.canEditTransform(node) ?? false;
      inspector.append(
        sectionBlock(
          'Transform',
          editT
            ? [
                vecEditor('position', () => node.position.toArray(), (v, c) => doc?.setTransform(node, 'position', v, c)),
                eulerEditor('rotation', () => eulerArr(node.rotation), (v, c) => doc?.setTransform(node, 'rotation', v, c)),
                vecEditor('scale', () => node.scale.toArray(), (v, c) => doc?.setTransform(node, 'scale', v, c)),
                boolEditor('visible', () => node.visible, (v) => doc?.setVisible(node, v)),
              ]
            : [
                row('position', vec(node.position)),
                row('rotation', euler(node.rotation)),
                row('scale', vec(node.scale)),
                row('visible', String(node.visible)),
              ],
        ),
      );
    }

    // Attachments (geometry / material / scene settings) from the compiled model.
    for (const view of doc?.attachmentsOf(node) ?? []) inspector.append(attachmentSection(node, view, doc));

    // Components — editable only on authored scene nodes.
    const editC = doc?.canEditComponents(node) ?? false;
    for (const component of engine().getComponents(node)) {
      inspector.append(sectionBlock(componentName(component) ?? component.constructor.name, componentRows(component, doc, editC)));
    }
  }

  /** A section for one attachment slot: editable inline attrs, or a `src` field for file-loaded ones. */
  function attachmentSection(node: Object3D, view: AttachmentView, doc: SceneDocument | undefined): HTMLElement {
    const def = getAttachmentDef(view.tag);
    const rows: HTMLElement[] = [];
    if (view.src !== null) {
      // Loaded from a file: only the src is editable; its props are read-only.
      rows.push(editRow('src', textField(() => view.src ?? '', (v) => doc?.setAttachmentSrc(node, view.slot, v))));
      for (const attr of Object.keys(def?.attrs ?? {})) rows.push(row(attr, fmt(view.attrs[attr])));
    } else {
      for (const [attr, meta] of Object.entries(def?.attrs ?? {})) {
        rows.push(attachmentAttrRow(node, view, attr, meta.type, view.editable, doc));
      }
    }
    return sectionBlock(view.tag, rows);
  }

  /** One attachment attribute, dispatched by type (reads/writes the compiled value). */
  function attachmentAttrRow(
    node: Object3D,
    view: AttachmentView,
    attr: string,
    type: NodeAttr['type'],
    editable: boolean,
    doc: SceneDocument | undefined,
  ): HTMLElement {
    const get = () => doc?.attachmentAttr(node, view.slot, attr) ?? view.attrs[attr];
    const commit = (v: number | boolean | string | number[], c?: { coalesce?: boolean }) =>
      doc?.setAttachmentProp(node, view.slot, attr, v, c);
    const elem = elementType(type);
    if (!editable) return row(attr, fmt(get()));
    if (isEnumType(elem) && !isArrayType(type)) return enumEditor(attr, elem, get, (v) => commit(v));
    if (isArrayType(type) || !isScalarType(elem)) return row(attr, fmt(get())); // arrays read-only this pass
    switch (elem) {
      case 'float':
      case 'int':
        return editRow(attr, numField(() => get() as number, (v, c) => commit(v, c), elem === 'int'));
      case 'bool':
        return boolEditor(attr, () => get() as boolean, (v) => commit(v));
      case 'string':
        return editRow(attr, textField(() => String(get() ?? ''), (v) => commit(v)));
      case 'color':
        return editRow(attr, colorField(() => get() as number, (v) => commit(v)));
      case 'vec2':
        return vecEditor(attr, () => get() as number[], (v, c) => commit(v, c), ['x', 'y']);
      case 'vec3':
        return vecEditor(attr, () => get() as number[], (v, c) => commit(v, c));
      case 'euler':
        return eulerEditor(attr, () => get() as number[], (v, c) => commit(v, c));
      default:
        return row(attr, fmt(get()));
    }
  }

  function componentRows(component: Component, doc: SceneDocument | undefined, editable: boolean): HTMLElement[] {
    const out: HTMLElement[] = [];
    // The component's scene id (addressable as `#id`), read-only — like a node's id.
    if (component.id) out.push(row('id', component.id));
    const meta = registeredMeta(component);
    if (meta) {
      const live = component as unknown as Record<string, unknown>;
      for (const [name, prop] of meta.properties) {
        out.push(editable ? propEditor(component, name, prop, doc) : row(name, fmt(live[name])));
      }
    }
    return out;
  }

  /** An editable row for a component `@property`, dispatched by its type. */
  function propEditor(component: Component, name: string, prop: PropertyMeta, doc: SceneDocument | undefined): HTMLElement {
    const live = component as unknown as Record<string, unknown>;
    const commit = (v: number | boolean | string | number[], c?: { coalesce?: boolean }) =>
      doc?.setComponentProp(component, name, v, c);
    const elem = elementType(prop.type);
    // Enums render as a dropdown of member names (the live field holds the native value).
    if (isEnumType(elem) && !isArrayType(prop.type)) {
      return enumEditor(name, elem, () => live[name], (v) => commit(v));
    }
    // References and arrays are read-only this pass.
    if (isArrayType(prop.type) || !isScalarType(elem)) return row(name, fmt(live[name]));
    switch (elem) {
      case 'float':
      case 'int':
        return editRow(name, numField(() => live[name] as number, (v, c) => commit(v, c), elem === 'int'));
      case 'bool':
        return boolEditor(name, () => live[name] as boolean, (v) => commit(v));
      case 'string':
        return editRow(name, textField(() => String(live[name] ?? ''), (v) => commit(v)));
      case 'color':
        return editRow(name, colorField(() => (live[name] as Color).getHex(), (v) => commit(v)));
      case 'vec2':
        return vecEditor(name, () => (live[name] as Vector2).toArray(), (v, c) => commit(v, c), ['x', 'y']);
      case 'vec3':
        return vecEditor(name, () => (live[name] as Vector3).toArray(), (v, c) => commit(v, c));
      case 'euler':
        return eulerEditor(name, () => eulerArr(live[name] as Euler), (v, c) => commit(v, c));
      default:
        return row(name, fmt(live[name]));
    }
  }

  // ── collapsible section ──────────────────────────────────────────────────────────

  function sectionBlock(title: string, rows: HTMLElement[]): HTMLElement {
    const wrap = div('sc-sec-wrap');
    const closed = closedSections.has(title);
    const head = div('sc-sec' + (closed ? ' closed' : ''));
    head.append(div('sc-caret', closed ? '▸' : '▾'), document.createTextNode(title));
    const body = div('sc-sec-body');
    if (closed) body.style.display = 'none';
    body.append(...rows);
    head.onclick = () => {
      if (closedSections.has(title)) closedSections.delete(title);
      else closedSections.add(title);
      const nowClosed = closedSections.has(title);
      body.style.display = nowClosed ? 'none' : '';
      head.classList.toggle('closed', nowClosed);
      (head.firstChild as HTMLElement).textContent = nowClosed ? '▸' : '▾';
    };
    wrap.append(head, body);
    return wrap;
  }

  renderTree();
  renderInspector();
  return {
    refresh: () => {
      renderTree();
      renderInspector();
    },
    select,
  };
}

// ── editable field builders ──────────────────────────────────────────────────────

/** A labelled multi-axis vector editor (x/y/z), each axis scrub + number input. */
function vecEditor(
  key: string,
  get: () => number[],
  commit: (value: number[], opts?: { coalesce?: boolean }) => void,
  labels: string[] = ['x', 'y', 'z'],
): HTMLElement {
  const r = div('sc-row sc-vec');
  r.append(div('k', key));
  const fields = div('v sc-axes');
  labels.forEach((axis, i) => {
    fields.append(
      axisField(
        axis,
        () => get()[i] ?? 0,
        (v, opts) => {
          const next = get();
          next[i] = v;
          commit(next, opts);
        },
      ),
    );
  });
  r.append(fields);
  return r;
}

/** Euler editor: UI in degrees, commits radians (the compiled/runtime unit). */
function eulerEditor(
  key: string,
  getRad: () => number[],
  commitRad: (value: number[], opts?: { coalesce?: boolean }) => void,
): HTMLElement {
  return vecEditor(
    key,
    () => getRad().map(toDeg),
    (degs, opts) => commitRad(degs.map(toRad), opts),
  );
}

/** One axis: a scrub handle (the axis letter) + a number input. */
function axisField(label: string, get: () => number, set: (v: number, opts?: { coalesce?: boolean }) => void): HTMLElement {
  const cell = div('sc-axis');
  const handle = div('sc-axis-k', label);
  const input = numInput(() => get(), (v, opts) => set(v, opts));
  scrub(handle, () => Number(input.value) || 0, (v) => {
    input.value = fmtNum(v);
    set(v, { coalesce: true });
  });
  cell.append(handle, input);
  return cell;
}

/** A standalone number row (single scalar property). */
function numField(get: () => number, set: (v: number, opts?: { coalesce?: boolean }) => void, int = false): HTMLElement {
  return numInput(get, (v, opts) => set(int ? Math.round(v) : v, opts), int);
}

function numInput(get: () => number, set: (v: number, opts?: { coalesce?: boolean }) => void, int = false): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'sc-input sc-num';
  input.inputMode = int ? 'numeric' : 'decimal';
  input.value = fmtNum(get());
  input.onchange = () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) set(int ? Math.round(v) : v);
  };
  return input;
}

function textField(get: () => string, set: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sc-input';
  input.value = get();
  input.onchange = () => set(input.value);
  return input;
}

function colorField(getHex: () => number, set: (hex: number) => void): HTMLElement {
  const wrap = div('sc-color');
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'sc-swatch';
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'sc-input sc-hex';
  const sync = () => {
    const css = '#' + getHex().toString(16).padStart(6, '0');
    picker.value = css;
    hex.value = css;
  };
  sync();
  picker.oninput = () => {
    hex.value = picker.value;
    set(parseInt(picker.value.slice(1), 16));
  };
  hex.onchange = () => {
    const v = parseInt(hex.value.replace(/^#/, ''), 16);
    if (Number.isFinite(v)) {
      set(v);
      picker.value = '#' + v.toString(16).padStart(6, '0');
    }
  };
  wrap.append(picker, hex);
  return wrap;
}

/** A dropdown of enum member names; maps the live native value ↔ its name. */
function enumEditor(key: string, def: EnumDef, get: () => unknown, set: (v: string | number) => void): HTMLElement {
  const select = document.createElement('select');
  select.className = 'sc-input sc-select';
  for (const member of def.names) {
    const opt = document.createElement('option');
    opt.value = member;
    opt.textContent = member;
    select.append(opt);
  }
  const current = def.byValue.get(get() as string | number);
  if (current !== undefined) select.value = current;
  select.onchange = () => {
    const value = def.byName.get(select.value);
    if (value !== undefined) set(value);
  };
  return editRow(key, select);
}

function boolEditor(key: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const r = div('sc-row');
  r.append(div('k', key));
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'sc-toggle';
  toggle.checked = get();
  toggle.onchange = () => set(toggle.checked);
  const v = div('v');
  v.append(toggle);
  r.append(v);
  return r;
}

/** Drag horizontally on `handle` to scrub a numeric value (pointer + touch). */
function scrub(handle: HTMLElement, get: () => number, set: (v: number) => void, step = 0.05): void {
  handle.classList.add('sc-scrub');
  let startX = 0;
  let startV = 0;
  let active = false;
  let pid = -1;
  handle.addEventListener('pointerdown', (e) => {
    active = true;
    pid = e.pointerId;
    startX = e.clientX;
    startV = get();
    handle.setPointerCapture(pid);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!active) return;
    set(startV + (e.clientX - startX) * step);
  });
  const end = (): void => {
    if (!active) return;
    active = false;
    try {
      handle.releasePointerCapture(pid);
    } catch {
      /* capture already gone */
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ── value formatting (read-only fallback) ─────────────────────────────────────────

function fmt(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean' || typeof v === 'string') return String(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  const o = v as Record<string, unknown> & { isVector3?: boolean; isVector2?: boolean; isColor?: boolean; isEuler?: boolean; isObject3D?: boolean };
  if (o.isVector3 || o.isVector2) return vec(o as unknown as Vector3);
  if (o.isEuler) return euler(o as unknown as Euler);
  if (o.isColor) return `#${(o as unknown as Color).getHexString()}`;
  if (o.isObject3D) return (o as unknown as Object3D).name || '(node)';
  if (o.constructor?.name === 'PrefabRef') return '(prefab)';
  if ('node' in o && 'engine' in o) return componentName(v as Component) ?? '(component)';
  return String(v);
}

const vec = (v: Vector3 | Vector2): string =>
  'z' in v ? `${round(v.x)} ${round(v.y)} ${round((v as Vector3).z)}` : `${round(v.x)} ${round(v.y)}`;
const euler = (e: Euler): string => `${toDeg(e.x)} ${toDeg(e.y)} ${toDeg(e.z)}`;
const eulerArr = (e: Euler): number[] => [e.x, e.y, e.z];
const toDeg = (rad: number): number => round((rad * 180) / Math.PI);
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const round = (n: number): number => Math.round(n * 1000) / 1000;
const fmtNum = (n: number): string => String(round(n));

// ── registry helpers ──────────────────────────────────────────────────────────────

function registeredMeta(component: Component) {
  for (const name of Registry.componentNames()) {
    const entry = Registry.getComponent(name);
    if (entry && component instanceof entry.ctor) return entry.meta;
  }
  return undefined;
}
function componentName(component: Component): string | undefined {
  for (const name of Registry.componentNames()) {
    const entry = Registry.getComponent(name);
    if (entry && component.constructor === entry.ctor) return name;
  }
  return undefined;
}

// ── DOM helpers ────────────────────────────────────────────────────────────────────

function div(className: string, text?: string): HTMLDivElement {
  const el = document.createElement('div');
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
/** A side drawer that slides off-screen, leaving an arrow tab to reopen it. */
function drawer(side: 'left' | 'right', heading: string, content: HTMLElement): HTMLElement {
  const el = div(`sc-drawer sc-${side}`);
  const panel = div('sc-panel');
  panel.append(titleEl(heading), content);
  const tab = document.createElement('button');
  tab.className = 'sc-tab';
  tab.title = `${heading} panel`;
  const sync = () => {
    const open = !el.classList.contains('collapsed');
    tab.textContent = side === 'left' ? (open ? '‹' : '›') : open ? '›' : '‹';
  };
  tab.onclick = () => {
    el.classList.toggle('collapsed');
    sync();
  };
  el.append(...(side === 'left' ? [panel, tab] : [tab, panel]));
  sync();
  return el;
}
function titleEl(text: string): HTMLDivElement {
  return div('sc-title', text);
}
function row(key: string, value: string): HTMLDivElement {
  const r = div('sc-row');
  r.append(div('k', key), div('v', value));
  return r;
}
/** A row whose value cell holds an editor element. */
function editRow(key: string, control: HTMLElement): HTMLDivElement {
  const r = div('sc-row');
  const v = div('v');
  v.append(control);
  r.append(div('k', key), v);
  return r;
}
function nodeLabel(node: Object3D): DocumentFragment {
  const frag = document.createDocumentFragment();
  const name = node.name || `(${typeName(node)})`;
  frag.append(document.createTextNode(name));
  if (node.name) {
    const ty = div('ty', `  ${typeName(node)}`);
    ty.style.display = 'inline';
    frag.append(ty);
  }
  return frag;
}
function typeName(node: Object3D): string {
  return node.type || node.constructor.name;
}
/** True if `object` (or an ancestor) is editor-internal — kept out of the Hierarchy. */
function isEditorOnly(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (o.userData.scenocoEditorOnly) return true;
  return false;
}
