import { useReducer } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Plus, Trash2, X } from 'lucide-react';
import type { Color, Euler, Object3D, Vector2, Vector3 } from 'three';
import {
  elementType, getAttachmentDef, getNodeDef, isArrayType, isEnumType, isScalarType, TRANSFORM_ATTRS, ValueType,
} from '@scenoco-three/core';
import type { Component, NodeAttr, PropertyMeta } from '@scenoco-three/core';
import type { AttachmentView, SceneDocument } from '../document.js';
import { componentName, registeredMeta } from '../meta.js';
import { getDeps, useUI } from './store.js';
import { HeadBtn } from './HeadBtn.js';
import { BoolRow, ColorRow, EnumRow, EulerRow, LockRow, NumberRow, ReadRow, TextRow, VecRow } from './fields.js';
import { euler, eulerDeg, fmt, vec } from './format.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

type Scalar = number | boolean | string | number[];

// Why a row is locked (shown as the lock's tooltip) — the editability audit made legible.
const PREFAB_REASON = 'Read-only: prefab content — edit the prefab file';
const SRC_REASON = 'Read-only: loaded from a src file — edit that file';
const REQUIRED_REASON = 'Required: this node needs at least one attachment of this group';
const TYPE_REASON = "Read-only: this value type isn't editable in the inspector yet";
// Node attrs are construction parameters (`NodeDef.build`), so an edit is saved to
// the XML and applies when the scene is reloaded — surfaced on the row, not hidden.
const RELOAD_NOTE = 'Applies on reload (a node attribute is set when the object is built)';

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
  const isScene = doc?.nodeOrigin(node).kind === 'scene';
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
            <VecRow label="position" value={node.position.toArray()} commit={(v, c) => doc?.setTransform(node, 'position', v, c)} description={TRANSFORM_ATTRS.position?.description} />
            {/* `eulerAngles` is the degrees view of `rotation`; the accessor is the
                one place units change, so the row stays degrees end to end. */}
            <EulerRow label="eulerAngles" value={node.eulerAngles.toArray()} commit={(v, c) => doc?.setTransform(node, 'eulerAngles', v, c)} description={TRANSFORM_ATTRS.eulerAngles?.description} />
            <VecRow label="scale" value={node.scale.toArray()} commit={(v, c) => doc?.setTransform(node, 'scale', v, c)} description={TRANSFORM_ATTRS.scale?.description} />
            <BoolRow label="visible" value={node.visible} commit={(v) => doc?.setVisible(node, v)} description={TRANSFORM_ATTRS.visible?.description} />
          </>
        ) : (
          <>
            <LockRow label="position" value={vec(node.position)} reason={PREFAB_REASON} description={TRANSFORM_ATTRS.position?.description} />
            <LockRow label="eulerAngles" value={euler(node.rotation)} reason={PREFAB_REASON} description={TRANSFORM_ATTRS.eulerAngles?.description} />
            <LockRow label="scale" value={vec(node.scale)} reason={PREFAB_REASON} description={TRANSFORM_ATTRS.scale?.description} />
            <LockRow label="visible" value={String(node.visible)} reason={PREFAB_REASON} description={TRANSFORM_ATTRS.visible?.description} />
          </>
        )}
      </Section>,
    );
  }

  // The node tag's own attributes (`<PerspectiveCamera fov near far>`) — the
  // `@property` fields its `@node` class declares. Previously invisible in the
  // inspector, so they could only be authored by hand in the XML.
  // Attachments (geometry / material / scene settings) from the compiled model.
  const attViews = doc?.attachmentsOf(node) ?? [];
  attViews.forEach((view, pos) => {
    sections.push(
      <AttachmentSection
        key={`att-${view.slot}`}
        node={node}
        view={view}
        doc={doc}
        canUp={pos > 0}
        canDown={pos < attViews.length - 1}
      />,
    );
  });
  // One entry point per area, so the picker always knows which kind it is offering.
  if (doc?.canEditStructure(node)) sections.push(<AddRow key="add-att" kind="attachment" node={node} />);

  // Components — editable only on authored scene nodes.
  const editC = doc?.canEditComponents(node) ?? false;
  const structural = doc?.canEditStructure(node) ?? false;
  // From the document, not the engine: it knows the compiled order (what the XML
  // will say) and which components are already deleted.
  const comps = doc?.componentsOf(node) ?? engine.getComponents(node).map((component) => ({ component, canMoveUp: false, canMoveDown: false }));
  comps.forEach(({ component, canMoveUp, canMoveDown }, i) => {
    sections.push(
      <Section
        key={`comp-${i}`}
        title={componentName(component) ?? component.constructor.name}
        description={registeredMeta(component)?.description}
        actions={
          structural ? (
            <MemberActions
              canUp={canMoveUp}
              canDown={canMoveDown}
              onUp={() => doc?.moveComponent(node, component, -1)}
              onDown={() => doc?.moveComponent(node, component, 1)}
              onDelete={() => doc?.removeComponent(node, component)}
            />
          ) : undefined
        }
      >
        <ComponentRows component={component} doc={doc} editable={editC} />
      </Section>,
    );
  });
  if (structural) sections.push(<AddRow key="add-comp" kind="component" node={node} />);

  return (
    <div className={styles.inspector}>
      <div className={cx(styles.secHead, styles.secHeadPlain)}>
        {typeName(node)}
        {getNodeDef(node.sceneTag ?? '')?.description ? (
          <span className={styles.secDesc}>{getNodeDef(node.sceneTag ?? '')!.description}</span>
        ) : null}
      </div>
      {node === engine.scene ? null : isScene ? (
        <TextRow label="id" value={node.sceneId ?? ''} commit={(v) => doc?.setId(node, v)} />
      ) : node.sceneId ? (
        <LockRow label="id" value={node.sceneId} reason={PREFAB_REASON} />
      ) : null}
      {/* The tag's own attributes belong to the node itself, so they sit directly
          under the header — a separate section would repeat the tag name and its
          description, which the header already shows. */}
      {Object.entries(getNodeDef(node.sceneTag ?? '')?.attrs ?? {}).map(([attr, meta]) => (
        <NodeAttrRow key={attr} node={node} attr={attr} meta={meta} editable={isScene} doc={doc} />
      ))}
      {sections}
    </div>
  );
}

/** The "+ Add …" row that opens the picker for one area. */
function AddRow({ kind, node }: { kind: 'component' | 'attachment'; node: Object3D }): React.JSX.Element {
  const openAdd = useUI((s) => s.openAdd);
  return (
    <button type="button" className={styles.addRow} onClick={() => openAdd(kind, node)}>
      <Plus />
      {kind === 'component' ? 'Add component' : 'Add attachment'}
    </button>
  );
}

/**
 * Per-member toolbar: reorder within the block, or delete. Buttons disable rather
 * than disappear so the row's shape stays stable — `title` says *why* when a move
 * is at the end of the list, or when the registry marks the attachment's group
 * `required` (a `Mesh` may not lose its only geometry).
 */
function MemberActions({
  onUp, onDown, onDelete, canUp, canDown, deleteReason,
}: {
  onUp: () => void; onDown: () => void; onDelete: () => void;
  canUp: boolean; canDown: boolean; deleteReason?: string;
}): React.JSX.Element {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation(); // the header itself toggles the fold
    fn();
  };
  return (
    <>
      <button type="button" className={styles.memberBtn} title="Move up" aria-label="Move up" disabled={!canUp} onClick={stop(onUp)}>
        <ChevronUp />
      </button>
      <button type="button" className={styles.memberBtn} title="Move down" aria-label="Move down" disabled={!canDown} onClick={stop(onDown)}>
        <ChevronDown />
      </button>
      <button
        type="button"
        className={cx(styles.memberBtn, styles.memberDelete)}
        title={deleteReason ?? 'Delete'}
        aria-label="Delete"
        disabled={deleteReason !== undefined}
        onClick={stop(onDelete)}
      >
        <Trash2 />
      </button>
    </>
  );
}

// ── attachments ────────────────────────────────────────────────────────────────

function AttachmentSection({
  node, view, doc, canUp, canDown,
}: {
  node: Object3D; view: AttachmentView; doc: SceneDocument | undefined; canUp: boolean; canDown: boolean;
}): React.JSX.Element {
  const def = getAttachmentDef(view.tag);
  const rows: ReactNode[] = [];
  if (view.src !== null) {
    // Loaded from a file: only the src is editable; its props are read-only.
    rows.push(<TextRow key="src" label="src" value={view.src ?? ''} commit={(v) => doc?.setAttachmentSrc(node, view.slot, v)} />);
    for (const [attr, meta] of Object.entries(def?.attrs ?? {}))
      rows.push(<LockRow key={attr} label={attr} value={fmt(view.attrs[attr])} reason={SRC_REASON} description={meta.description} />);
  } else {
    for (const [attr, meta] of Object.entries(def?.attrs ?? {})) {
      rows.push(<AttachmentAttr key={attr} node={node} view={view} attr={attr} type={meta.type} description={meta.description} editable={view.editable} doc={doc} />);
    }
  }
  const structural = doc?.canEditStructure(node) ?? false;
  const actions = structural ? (
    <MemberActions
      canUp={canUp}
      canDown={canDown}
      onUp={() => doc?.moveAttachment(node, view.slot, -1)}
      onDown={() => doc?.moveAttachment(node, view.slot, 1)}
      onDelete={() => doc?.removeAttachment(node, view.slot)}
      deleteReason={doc?.canRemoveAttachment(node, view.slot) ? undefined : REQUIRED_REASON}
    />
  ) : undefined;
  return (
    <Section title={view.tag} description={def?.description} actions={actions}>
      {rows}
    </Section>
  );
}

/** One attachment attribute, dispatched by type (reads/writes the compiled value). */
function AttachmentAttr({
  node, view, attr, type, description, editable, doc,
}: {
  node: Object3D; view: AttachmentView; attr: string; type: NodeAttr['type']; description?: string; editable: boolean; doc: SceneDocument | undefined;
}): React.JSX.Element {
  const value = doc?.attachmentAttr(node, view.slot, attr) ?? view.attrs[attr];
  const commit = (v: Scalar, c?: { coalesce?: boolean }): void => doc?.setAttachmentProp(node, view.slot, attr, v, c);
  const elem = elementType(type);
  // An inline attachment is part of this scene's XML, so it gets the same
  // written/default treatment as everything else here. (A `src=`-loaded one never
  // reaches this component — it renders locked above.)
  const written = doc?.isAttachmentAttrSet(node, view.slot, attr) ?? false;
  const unset = !written;
  const onClear = written && editable ? (): void => doc?.clearAttachmentAttr(node, view.slot, attr) : undefined;
  const desc = `${description ?? ''}${written ? '' : '\n\nDefault — not written in the file.'}`.trim();
  if (!editable) return <LockRow label={attr} value={fmt(value)} reason={PREFAB_REASON} description={description} />;
  if (isEnumType(elem) && !isArrayType(type)) return <EnumRow label={attr} def={elem} value={value} commit={(v) => commit(v)} unset={unset} onClear={onClear} />;
  if (isArrayType(type) || !isScalarType(elem)) return <LockRow label={attr} value={fmt(value)} reason={TYPE_REASON} description={description} />;
  switch (elem) {
    case ValueType.Float:
    case ValueType.Int:
      return <NumberRow label={attr} value={value as number} commit={(v) => commit(v)} int={elem === ValueType.Int} unset={unset} onClear={onClear} />;
    case ValueType.Bool:
      return <BoolRow label={attr} value={value as boolean} commit={(v) => commit(v)} unset={unset} onClear={onClear} />;
    case ValueType.String:
      return <TextRow label={attr} value={String(value ?? '')} commit={(v) => commit(v)} unset={unset} onClear={onClear} />;
    case ValueType.Color:
      return <ColorRow label={attr} value={value as number} commit={(v) => commit(v)} unset={unset} onClear={onClear} />;
    case ValueType.Vec2:
      return <VecRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} labels={['x', 'y']} unset={unset} onClear={onClear} />;
    case ValueType.Vec3:
      return <VecRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} unset={unset} onClear={onClear} />;
    case ValueType.Euler:
      return <EulerRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} unset={unset} onClear={onClear} />;
    default:
      return <LockRow label={attr} value={fmt(value)} reason={TYPE_REASON} description={description} />;
  }
}

/** A renderable stand-in for an unset optional attribute, by value type. */
function neutralValue(elem: ReturnType<typeof elementType>): Scalar {
  switch (elem) {
    case ValueType.Bool:
      return false;
    case ValueType.String:
      return '';
    case ValueType.Vec2:
      return [0, 0];
    case ValueType.Vec3:
    case ValueType.Euler:
      return [0, 0, 0];
    default:
      return 0; // Float / Int / Color (0x000000)
  }
}

/** One node-tag attribute, dispatched by type (compiled value in, compiled value out). */
function NodeAttrRow({
  node, attr, meta, editable, doc,
}: {
  node: Object3D; attr: string; meta: NodeAttr; editable: boolean; doc: SceneDocument | undefined;
}): React.JSX.Element {
  const commit = (v: Scalar, c?: { coalesce?: boolean }): void => doc?.setNodeAttr(node, attr, v, c);
  const elem = elementType(meta.type);
  // An *optional* attribute (`backgroundColor?: number` with no initializer) has
  // neither an authored value nor a registry default, so this is undefined. The
  // row still has to render — and stay editable, since setting it is the point —
  // so seed the widget with a neutral value of the right shape. Nothing is written
  // until the user actually commits.
  // Three states, and the difference matters for what gets written:
  //   written   — the attribute is in the XML; clearable via ×
  //   defaulted — absent from the XML, but the @property has a default to show
  //   unset     — absent with no default (an optional `backgroundColor?: number`)
  // Only an actual user edit writes anything; rendering never does.
  const written = doc?.isNodeAttrSet(node, attr) ?? false;
  const raw = doc?.nodeAttr(node, attr);
  const value = raw === undefined ? neutralValue(elem) : raw;
  const unset = !written;
  const state = written ? '' : raw === undefined ? '\n\nUnset — not written in the file.' : '\n\nDefault — not written in the file.';
  const desc = `${meta.description}${state}\n\n${RELOAD_NOTE}`;
  const onClear = written ? (): void => doc?.clearNodeAttr(node, attr) : undefined;
  if (!editable) return <LockRow label={attr} value={fmt(value)} reason={PREFAB_REASON} description={meta.description} />;
  if (isEnumType(elem) && !isArrayType(meta.type)) return <EnumRow label={attr} def={elem} value={value} commit={(v) => commit(v)} description={desc} unset={unset} onClear={onClear} />;
  if (isArrayType(meta.type) || !isScalarType(elem)) return <LockRow label={attr} value={fmt(value)} reason={TYPE_REASON} description={meta.description} />;
  switch (elem) {
    case ValueType.Float:
    case ValueType.Int:
      return <NumberRow label={attr} value={value as number} commit={(v) => commit(v)} int={elem === ValueType.Int} description={desc} unset={unset} onClear={onClear} />;
    case ValueType.Bool:
      return <BoolRow label={attr} value={value as boolean} commit={(v) => commit(v)} description={desc} unset={unset} onClear={onClear} />;
    case ValueType.String:
      return <TextRow label={attr} value={String(value ?? '')} commit={(v) => commit(v)} description={desc} unset={unset} onClear={onClear} />;
    case ValueType.Color:
      return <ColorRow label={attr} value={value as number} commit={(v) => commit(v)} description={desc} unset={unset} onClear={onClear} />;
    case ValueType.Vec2:
      return <VecRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} labels={['x', 'y']} description={desc} unset={unset} onClear={onClear} />;
    case ValueType.Vec3:
      return <VecRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} description={desc} unset={unset} onClear={onClear} />;
    case ValueType.Euler:
      return <EulerRow label={attr} value={value as number[]} commit={(v, c) => commit(v, c)} description={desc} unset={unset} onClear={onClear} />;
    default:
      return <LockRow label={attr} value={fmt(value)} reason={TYPE_REASON} description={meta.description} />;
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
          <LockRow key={name} label={name} value={fmt(live[name])} reason={PREFAB_REASON} description={prop.description} />
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
  // Same three states as a node attribute: written (clearable via ×) vs. left at
  // the `@property` default. The row shows the live value either way.
  const written = doc?.isComponentPropSet(component, name) ?? false;
  const unset = !written;
  const onClear = written ? (): void => doc?.clearComponentProp(component, name) : undefined;
  const desc = `${prop.description}${written ? '' : '\n\nDefault — not written in the file.'}`;
  if (isEnumType(elem) && !isArrayType(prop.type)) return <EnumRow label={name} def={elem} value={val} commit={(v) => commit(v)} unset={unset} onClear={onClear} />;
  if (isArrayType(prop.type) || !isScalarType(elem)) return <LockRow label={name} value={fmt(val)} reason={TYPE_REASON} description={prop.description} />;
  switch (elem) {
    case ValueType.Float:
    case ValueType.Int:
      return <NumberRow label={name} value={val as number} commit={(v) => commit(v)} int={elem === ValueType.Int} unset={unset} onClear={onClear} />;
    case ValueType.Bool:
      return <BoolRow label={name} value={val as boolean} commit={(v) => commit(v)} unset={unset} onClear={onClear} />;
    case ValueType.String:
      return <TextRow label={name} value={String(val ?? '')} commit={(v) => commit(v)} unset={unset} onClear={onClear} />;
    case ValueType.Color:
      return <ColorRow label={name} value={(val as Color).getHex()} commit={(v) => commit(v)} unset={unset} onClear={onClear} />;
    case ValueType.Vec2:
      return <VecRow label={name} value={(val as Vector2).toArray()} commit={(v, c) => commit(v, c)} labels={['x', 'y']} unset={unset} onClear={onClear} />;
    case ValueType.Vec3:
      return <VecRow label={name} value={(val as Vector3).toArray()} commit={(v, c) => commit(v, c)} unset={unset} onClear={onClear} />;
    case ValueType.Euler:
      // A component field holds a live radians `Euler`; the row is degrees.
      return <EulerRow label={name} value={eulerDeg(val as Euler)} commit={(v, c) => commit(v, c)} description={desc} unset={unset} onClear={onClear} />;
    default:
      return <LockRow label={name} value={fmt(val)} reason={TYPE_REASON} description={prop.description} />;
  }
}

// ── collapsible section ────────────────────────────────────────────────────────

/** Section fold state, kept module-level so it survives sheet close/reopen. */
const closedSections = new Set<string>();

function Section({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }): React.JSX.Element {
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
        {actions ? <span className={styles.secActions}>{actions}</span> : null}
        {description ? <span className={styles.secDesc}>{description}</span> : null}
      </div>
      {!closed && <div className={styles.secBody}>{children}</div>}
    </div>
  );
}
