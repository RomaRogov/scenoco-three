import type { Color, Euler, Object3D, Vector2, Vector3 } from 'three';
import {
  elementType,
  getAttachmentDef,
  isArrayType,
  isEnumType,
  isScalarType,
  type Component,
  type Engine,
  type NodeAttr,
  type PropertyMeta,
} from '@scenoco-three/core';
import { ValueType } from '@scenoco-three/core';
import type { AttachmentView, SceneDocument } from './document.js';
import { componentName, isEditorOnly, registeredMeta } from './meta.js';
import {
  boolEditor, colorField, div, editRow, enumEditor, eulerArr, eulerEditor, euler, fmt, numField, row,
  textField, vec, vecEditor,
} from './fields.js';

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
      case ValueType.Float:
      case ValueType.Int:
        return editRow(attr, numField(() => get() as number, (v, c) => commit(v, c), elem === ValueType.Int));
      case ValueType.Bool:
        return boolEditor(attr, () => get() as boolean, (v) => commit(v));
      case ValueType.String:
        return editRow(attr, textField(() => String(get() ?? ''), (v) => commit(v)));
      case ValueType.Color:
        return editRow(attr, colorField(() => get() as number, (v) => commit(v)));
      case ValueType.Vec2:
        return vecEditor(attr, () => get() as number[], (v, c) => commit(v, c), ['x', 'y']);
      case ValueType.Vec3:
        return vecEditor(attr, () => get() as number[], (v, c) => commit(v, c));
      case ValueType.Euler:
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
      case ValueType.Float:
      case ValueType.Int:
        return editRow(name, numField(() => live[name] as number, (v, c) => commit(v, c), elem === ValueType.Int));
      case ValueType.Bool:
        return boolEditor(name, () => live[name] as boolean, (v) => commit(v));
      case ValueType.String:
        return editRow(name, textField(() => String(live[name] ?? ''), (v) => commit(v)));
      case ValueType.Color:
        return editRow(name, colorField(() => (live[name] as Color).getHex(), (v) => commit(v)));
      case ValueType.Vec2:
        return vecEditor(name, () => (live[name] as Vector2).toArray(), (v, c) => commit(v, c), ['x', 'y']);
      case ValueType.Vec3:
        return vecEditor(name, () => (live[name] as Vector3).toArray(), (v, c) => commit(v, c));
      case ValueType.Euler:
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

// ── panel chrome ────────────────────────────────────────────────────────────────────

/** A side drawer that slides off-screen, leaving an arrow tab to reopen it. */
function drawer(side: 'left' | 'right', heading: string, content: HTMLElement): HTMLElement {
  const el = div(`sc-drawer sc-${side}`);
  const panel = div('sc-panel');
  panel.append(div('sc-title', heading), content);
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
