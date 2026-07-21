import { useReducer } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { Color, Euler, Object3D, Vector2, Vector3 } from 'three';
import {
  elementType, getAttachmentDef, isArrayType, isEnumType, isScalarType, ValueType,
} from '@scenoco-three/core';
import type { Component, NodeAttr, PropertyMeta } from '@scenoco-three/core';
import type { AttachmentView, SceneDocument } from '../document.js';
import { componentName, registeredMeta } from '../meta.js';
import { getDeps, useUI } from './store.js';
import { HeadBtn } from './HeadBtn.js';
import { BoolRow, ColorRow, EnumRow, EulerRow, NumberRow, ReadRow, TextRow, VecRow } from './fields.js';
import { euler, eulerArr, fmt, vec } from './format.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

type Scalar = number | boolean | string | number[];

/**
 * The inspector: a bottom sheet that edits the selected node's transform,
 * attachments (geometry/material), and component `@property` values. Every edit
 * routes through the active SceneDocument (undoable + savable), exactly as the old
 * `panels.ts` inspector did. Re-reads live values on every store `rev`.
 */
export function InspectorSheet(): React.JSX.Element | null {
  const open = useUI((s) => s.inspectorOpen);
  useUI((s) => s.rev); // re-read live values on refresh
  const selected = useUI((s) => s.selected);
  const closeInspector = useUI((s) => s.closeInspector);
  if (!open) return null;

  return (
    <div className={cx(styles.sheet, styles.sheetInspector)}>
      <div className={styles.head}>
        <span className={styles.title}>Inspector</span>
        <div className={styles.actions}>
          <HeadBtn label="Close" onClick={closeInspector}>
            <X />
          </HeadBtn>
        </div>
      </div>
      <div className={styles.body}>
        {selected ? (
          <InspectorBody node={selected} />
        ) : (
          <div className={styles.inspector}>
            <div className={styles.empty}>Select a node — tap it in the viewport or the node list.</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Prefer the authored DSL tag over Three's generic `.type` (see Tree.tsx). */
function typeName(node: Object3D): string {
  return node.sceneTag || node.type || node.constructor.name;
}

function InspectorBody({ node }: { node: Object3D }): React.JSX.Element {
  const { getEngine, getDoc } = getDeps();
  const engine = getEngine();
  const doc = getDoc();
  const sections: ReactNode[] = [];

  // A prefab instance: its `src` is editable (swap the prefab); content below read-only.
  const prefabSrc = doc?.prefabSrc(node);
  if (prefabSrc !== undefined) {
    sections.push(
      <Section key="prefab" title="Prefab">
        <TextRow label="src" value={prefabSrc} commit={(v) => doc?.setNodeSrc(node, v)} />
      </Section>,
    );
  }

  // Transform — editable on authored nodes + prefab roots; read-only inside a prefab.
  if (node !== engine.scene) {
    const editT = doc?.canEditTransform(node) ?? false;
    sections.push(
      <Section key="transform" title="Transform">
        {editT ? (
          <>
            <VecRow label="position" value={node.position.toArray()} commit={(v, c) => doc?.setTransform(node, 'position', v, c)} />
            <EulerRow label="eulerAngles" value={eulerArr(node.rotation)} commit={(v, c) => doc?.setTransform(node, 'eulerAngles', v, c)} />
            <VecRow label="scale" value={node.scale.toArray()} commit={(v, c) => doc?.setTransform(node, 'scale', v, c)} />
            <BoolRow label="visible" value={node.visible} commit={(v) => doc?.setVisible(node, v)} />
          </>
        ) : (
          <>
            <ReadRow label="position" value={vec(node.position)} />
            <ReadRow label="eulerAngles" value={euler(node.rotation)} />
            <ReadRow label="scale" value={vec(node.scale)} />
            <ReadRow label="visible" value={String(node.visible)} />
          </>
        )}
      </Section>,
    );
  }

  // Attachments (geometry / material / scene settings) from the compiled model.
  for (const view of doc?.attachmentsOf(node) ?? []) {
    sections.push(<AttachmentSection key={`att-${view.slot}`} node={node} view={view} doc={doc} />);
  }

  // Components — editable only on authored scene nodes.
  const editC = doc?.canEditComponents(node) ?? false;
  engine.getComponents(node).forEach((component, i) => {
    sections.push(
      <Section key={`comp-${i}`} title={componentName(component) ?? component.constructor.name}>
        <ComponentRows component={component} doc={doc} editable={editC} />
      </Section>,
    );
  });

  return (
    <div className={styles.inspector}>
      <div className={cx(styles.secHead, styles.secHeadPlain)}>{typeName(node)}</div>
      {node.sceneId ? <ReadRow label="id" value={node.sceneId} /> : null}
      {sections}
    </div>
  );
}

// ── attachments ────────────────────────────────────────────────────────────────

function AttachmentSection({ node, view, doc }: { node: Object3D; view: AttachmentView; doc: SceneDocument | undefined }): React.JSX.Element {
  const def = getAttachmentDef(view.tag);
  const rows: ReactNode[] = [];
  if (view.src !== null) {
    // Loaded from a file: only the src is editable; its props are read-only.
    rows.push(<TextRow key="src" label="src" value={view.src ?? ''} commit={(v) => doc?.setAttachmentSrc(node, view.slot, v)} />);
    for (const attr of Object.keys(def?.attrs ?? {})) rows.push(<ReadRow key={attr} label={attr} value={fmt(view.attrs[attr])} />);
  } else {
    for (const [attr, meta] of Object.entries(def?.attrs ?? {})) {
      rows.push(<AttachmentAttr key={attr} node={node} view={view} attr={attr} type={meta.type} editable={view.editable} doc={doc} />);
    }
  }
  return <Section title={view.tag}>{rows}</Section>;
}

/** One attachment attribute, dispatched by type (reads/writes the compiled value). */
function AttachmentAttr({
  node, view, attr, type, editable, doc,
}: {
  node: Object3D; view: AttachmentView; attr: string; type: NodeAttr['type']; editable: boolean; doc: SceneDocument | undefined;
}): React.JSX.Element {
  const value = doc?.attachmentAttr(node, view.slot, attr) ?? view.attrs[attr];
  const commit = (v: Scalar, c?: { coalesce?: boolean }): void => doc?.setAttachmentProp(node, view.slot, attr, v, c);
  const elem = elementType(type);
  if (!editable) return <ReadRow label={attr} value={fmt(value)} />;
  if (isEnumType(elem) && !isArrayType(type)) return <EnumRow label={attr} def={elem} value={value} commit={(v) => commit(v)} />;
  if (isArrayType(type) || !isScalarType(elem)) return <ReadRow label={attr} value={fmt(value)} />;
  switch (elem) {
    case ValueType.Float:
    case ValueType.Int:
      return <NumberRow label={attr} value={value as number} commit={(v) => commit(v)} int={elem === ValueType.Int} />;
    case ValueType.Bool:
      return <BoolRow label={attr} value={value as boolean} commit={(v) => commit(v)} />;
    case ValueType.String:
      return <TextRow label={attr} value={String(value ?? '')} commit={(v) => commit(v)} />;
    case ValueType.Color:
      return <ColorRow label={attr} value={value as number} commit={(v) => commit(v)} />;
    case ValueType.Vec2:
      return <VecRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} labels={['x', 'y']} />;
    case ValueType.Vec3:
      return <VecRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} />;
    case ValueType.Euler:
      return <EulerRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} />;
    default:
      return <ReadRow label={attr} value={fmt(value)} />;
  }
}

// ── components ─────────────────────────────────────────────────────────────────

function ComponentRows({ component, doc, editable }: { component: Component; doc: SceneDocument | undefined; editable: boolean }): React.JSX.Element {
  const rows: ReactNode[] = [];
  if (component.id) rows.push(<ReadRow key="id" label="id" value={component.id} />);
  const meta = registeredMeta(component);
  if (meta) {
    const live = component as unknown as Record<string, unknown>;
    for (const [name, prop] of meta.properties) {
      rows.push(
        editable ? (
          <PropEditor key={name} component={component} name={name} prop={prop} doc={doc} />
        ) : (
          <ReadRow key={name} label={name} value={fmt(live[name])} />
        ),
      );
    }
  }
  return <>{rows}</>;
}

/** An editable row for a component `@property`, dispatched by its type. */
function PropEditor({ component, name, prop, doc }: { component: Component; name: string; prop: PropertyMeta; doc: SceneDocument | undefined }): React.JSX.Element {
  const live = component as unknown as Record<string, unknown>;
  const commit = (v: Scalar, c?: { coalesce?: boolean }): void => doc?.setComponentProp(component, name, v, c);
  const elem = elementType(prop.type);
  const val = live[name];
  if (isEnumType(elem) && !isArrayType(prop.type)) return <EnumRow label={name} def={elem} value={val} commit={(v) => commit(v)} />;
  if (isArrayType(prop.type) || !isScalarType(elem)) return <ReadRow label={name} value={fmt(val)} />;
  switch (elem) {
    case ValueType.Float:
    case ValueType.Int:
      return <NumberRow label={name} value={val as number} commit={(v) => commit(v)} int={elem === ValueType.Int} />;
    case ValueType.Bool:
      return <BoolRow label={name} value={val as boolean} commit={(v) => commit(v)} />;
    case ValueType.String:
      return <TextRow label={name} value={String(val ?? '')} commit={(v) => commit(v)} />;
    case ValueType.Color:
      return <ColorRow label={name} value={(val as Color).getHex()} commit={(v) => commit(v)} />;
    case ValueType.Vec2:
      return <VecRow label={name} value={(val as Vector2).toArray()} commit={(v, c) => commit(v, c)} labels={['x', 'y']} />;
    case ValueType.Vec3:
      return <VecRow label={name} value={(val as Vector3).toArray()} commit={(v, c) => commit(v, c)} />;
    case ValueType.Euler:
      return <EulerRow label={name} value={eulerArr(val as Euler)} commit={(v, c) => commit(v, c)} />;
    default:
      return <ReadRow label={name} value={fmt(val)} />;
  }
}

// ── collapsible section ────────────────────────────────────────────────────────

/** Section fold state, kept module-level so it survives sheet close/reopen. */
const closedSections = new Set<string>();

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const closed = closedSections.has(title);
  const toggle = (): void => {
    if (closed) closedSections.delete(title);
    else closedSections.add(title);
    force();
  };
  return (
    <div className={styles.section}>
      <div className={styles.secHead} onClick={toggle}>
        <span className={styles.secCaret}>{closed ? <ChevronRight /> : <ChevronDown />}</span>
        {title}
      </div>
      {!closed && <div className={styles.secBody}>{children}</div>}
    </div>
  );
}
