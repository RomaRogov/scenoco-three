import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import type { Object3D } from 'three';
import type { PropInfo } from '@scenoco-three/compiler';
import type { Attachment, SceneDocument } from '../document.js';
import { shownValue, widgetFor, type Scalar } from '../values.js';
import { getDeps, useUI } from './store.js';
import { cx } from './cx.js';
import { BoolRow, ColorRow, EnumRow, EulerRow, LockRow, NumberRow, TextRow, VecRow } from './fields.js';
import { HeadBtn } from './HeadBtn.js';
import styles from './ui.module.css';

/**
 * The inspector.
 *
 * ### What it shows
 *
 * Everything the open document **can** write, with what it *does* write marked and clearable. A
 * field left unwritten inherits whatever the class decides later; one written with today's default
 * is pinned to today's value — so the distinction is worth showing, and it is why `PropInfo`
 * carries `default` separately from the current value.
 *
 * ### Where the schema comes from
 *
 * `ProjectModel`, read from the project's own TypeScript: field names, types, defaults, doc
 * comments. Nothing is restated anywhere, so nothing can drift.
 */
const PREFAB_REASON = 'From another document — open it to edit this.';
const TYPE_REASON = 'No attribute can express this type.';
/** A slot an element fills. Naming a file here as well would be two materials for one mesh. */
const ATTACHED_REASON = (tag: string) => `Written as a <${tag}> inside this node.`;

/** Sections the user has folded away, by title. Module state: one inspector per page. */
const closedSections = new Set<string>();
/** Sections already shown once, so `startClosed` folds them the first time and never again. */
const seenSections = new Set<string>();

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

function InspectorBody({ node }: { node: Object3D }): React.JSX.Element {
  const { getDoc } = getDeps();
  const doc = getDoc();
  const foreign = doc?.foreignSource(node);
  const mine = doc?.canEditTransform(node) ?? false;
  const sections: ReactNode[] = [];

  const tag = doc?.tagOf(node);
  const tagName = doc?.tagNameOf(node) ?? node.type;

  // A slot written as an element is not writable as an attribute: the compiler reports a node
  // given both, so the row says where the value lives instead of offering a second one.
  const attachments = doc?.attachmentsOf(node) ?? [];
  const attachedBySlot = new Map(attachments.map((a) => [a.slot, a]));

  const renderNodeProp = (prop: PropInfo): React.JSX.Element => {
    const attached = attachedBySlot.get(prop.name);
    if (attached) {
      return (
        <LockRow
          key={prop.name}
          label={prop.name}
          value={`<${attached.tag.name}>`}
          reason={ATTACHED_REASON(attached.tag.name)}
          description={prop.description}
        />
      );
    }
    return (
      <PropRow
        key={prop.name}
        prop={prop}
        written={doc?.nodeAttr(node, prop.name)}
        editable={mine}
        commit={(v, c) => doc?.setNodeValue(node, prop, v, c)}
        clear={() => doc?.clearNodeAttr(node, prop.name)}
      />
    );
  };
  const tagProps = split([...(tag?.parameters ?? []), ...(tag?.properties ?? [])], (p) =>
    doc?.nodeAttr(node, p.name) !== undefined,
  );

  // Placement, which every node takes. Written from the live object, so a gizmo drag and a typed
  // number are the same edit — in the document's units, which for rotation means degrees.
  const placement = (
    <Section key="placement" title="Placement">
      {mine ? (
        <>
          <VecRow
            label="position"
            value={node.position.toArray()}
            commit={(v, c) => commitVector(doc, node, 'position', v, c)}
            description="Local position"
          />
          <EulerRow
            label="eulerAngles"
            value={node.eulerAngles.toArray()}
            commit={(v, c) => commitVector(doc, node, 'eulerAngles', v, c)}
            description="Local rotation, in degrees"
          />
          <VecRow
            label="scale"
            value={node.scale.toArray()}
            commit={(v, c) => commitVector(doc, node, 'scale', v, c)}
            description="Local scale"
          />
        </>
      ) : (
        <>
          <LockRow label="position" value={fmtVec(node.position.toArray())} reason={PREFAB_REASON} />
          <LockRow label="eulerAngles" value={fmtVec(node.eulerAngles.toArray())} reason={PREFAB_REASON} />
          <LockRow label="scale" value={fmtVec(node.scale.toArray())} reason={PREFAB_REASON} />
        </>
      )}
    </Section>
  );

  // The components on this node, each with what its class declares.
  for (const [i, { component, info }] of (doc?.componentsOf(node) ?? []).entries()) {
    const name = component.constructor.name;
    // Per component, not per node: a prefab instance sits in this document while its components
    // are declared in the prefab's, and only the second question decides whether a field writes.
    const editableHere = doc?.canEditComponent(component) ?? false;
    sections.push(
      <Section
        key={`comp-${i}`}
        title={name}
        {...(info?.description ? { description: info.description } : {})}
        actions={
          editableHere ? <MemberActions onDelete={() => doc?.removeComponent(component)} /> : undefined
        }
      >
        {(() => {
          const render = (prop: PropInfo): React.JSX.Element => (
            <PropRow
              key={prop.name}
              prop={prop}
              written={doc?.componentProp(component, prop.name)}
              editable={editableHere}
              {...(editableHere ? {} : { live: liveText(component, prop.name) })}
              commit={(v, c) => doc?.setComponentValue(component, prop, v, c)}
              clear={() => doc?.clearComponentProp(component, prop.name)}
            />
          );
          const fields = split(info?.fields ?? [], (p) => doc?.componentProp(component, p.name) !== undefined);
          return (
            <>
              {fields.written.map(render)}
              {fields.rest.length > 0 ? (
                <Section title={`${fields.rest.length} more on ${name}`} startClosed>
                  {fields.rest.map(render)}
                </Section>
              ) : null}
            </>
          );
        })()}
      </Section>,
    );
  }
  // What this node is built from, under the node itself: an attached object is not in the tree,
  // because it never became one.
  for (const [i, attachment] of attachments.entries()) {
    sections.push(
      <AttachmentSection
        key={`attached-${i}`}
        attachment={attachment}
        editable={mine}
        doc={doc}
      />,
    );
  }
  if (doc?.canEditComponents(node)) sections.push(<AddRow key="add-comp" node={node} />);

  return (
    <div className={styles.inspector}>
      <div className={cx(styles.secHead, styles.secHeadPlain)}>
        {tagName}
        {foreign ? <span className={styles.secDesc}>from {foreign}</span> : null}
      </div>

      {/* Unity's order, and for Unity's reason: what a node *is* — its name and whether it is
          on — then where it is, then what it does. Identity and placement are what you reach for
          on almost every selection; a tag's own attributes and its components are what you came
          for on some of them. */}
      {mine ? (
        <IdentityRow
          id={doc?.nodeAttr(node, 'id') ?? ''}
          active={doc?.nodeAttr(node, 'active') !== 'false'}
          setId={(v) => doc?.setNodeAttr(node, 'id', v === '' ? null : v)}
          setActive={(v) => doc?.setNodeAttr(node, 'active', v ? null : 'false')}
        />
      ) : null}
      {mine ? (
        <BoolRow
          label="visible"
          value={node.visible}
          commit={(v) => doc?.setVisible(node, v)}
          unset={doc?.nodeAttr(node, 'visible') === undefined}
          description="Hides the node while it keeps updating. `active` turns the whole subtree off."
          {...(doc?.nodeAttr(node, 'visible') !== undefined
            ? { onClear: () => doc?.clearNodeAttr(node, 'visible') }
            : {})}
        />
      ) : null}

      {placement}

      {/* The tag's own attributes — a camera's `fov`, a light's `intensity` — read from
          three.js's declarations rather than from a table in this repo.

          What the document *writes* stays in front; the rest folds away. `Mesh` alone declares
          some thirty settable properties and a package that augments `Object3D` adds its own to
          every tag, so showing all of them inline buries the three that were authored. */}
      {tagProps.written.length > 0 || tagProps.rest.length > 0 ? (
        <Section title={`<${tagName}>`}>
          {tagProps.written.map(renderNodeProp)}
          {tagProps.rest.length > 0 ? (
            <Section title={`${tagProps.rest.length} more on <${tagName}>`} startClosed>
              {tagProps.rest.map(renderNodeProp)}
            </Section>
          ) : null}
        </Section>
      ) : null}

      {sections}
    </div>
  );
}

/**
 * One attribute, dispatched by its **shape** — the single question the whole DSL rests on, and
 * the one the compiler already answered by reading the field's type. A field is a colour because
 * it is declared `Color`.
 */
function PropRow({
  prop,
  written,
  editable,
  live,
  commit,
  clear,
}: {
  prop: PropInfo;
  written: string | undefined;
  editable: boolean;
  /** What the object actually holds — shown on a locked row, where `written` says nothing. */
  live?: string | undefined;
  commit: (value: Scalar, opts?: { coalesce?: boolean }) => void;
  clear: () => void;
}): React.JSX.Element | null {
  const shape = widgetFor(prop);
  const value = shownValue(prop, written);
  const unset = written === undefined;
  const description = `${prop.description ?? prop.type}${unset ? '\n\nDefault — not written in the file.' : ''}`;
  const onClear = !unset && editable ? clear : undefined;

  if (shape === null) return <LockRow label={prop.name} value={String(value)} reason={TYPE_REASON} description={prop.description} />;
  // A locked row prefers the live value. The document has nothing written for something another
  // file declares, and falling back to the class default *looks* like a fact: a crate whose
  // prefab sets `gravityScale` to 1 would read 0 here, which is worse than saying nothing.
  if (!editable) {
    return (
      <LockRow
        label={prop.name}
        // Blank rather than the class default when the live value is not something a row can
        // show: the document says nothing about this field, so neither should the inspector.
        value={live ?? ''}
        reason={PREFAB_REASON}
        description={prop.description}
      />
    );
  }

  const common = { label: prop.name, description, unset, ...(onClear ? { onClear } : {}) };
  switch (shape) {
    case 'number':
      return <NumberRow {...common} value={value as number} commit={(v, c) => commit(v, c)} />;
    case 'boolean':
      return <BoolRow {...common} value={value as boolean} commit={(v) => commit(v)} />;
    case 'color':
      return <ColorRow {...common} value={value as number} commit={(v) => commit(v)} />;
    case 'vector2':
      return <VecRow {...common} value={value as number[]} labels={['x', 'y']} commit={(v, c) => commit(v, c)} />;
    case 'vector3':
    case 'vector4':
      return <VecRow {...common} value={value as number[]} commit={(v, c) => commit(v, c)} />;
    case 'euler':
      return <EulerRow {...common} value={value as number[]} commit={(v, c) => commit(v, c)} />;
    case 'enum':
      return (
        <EnumRow
          {...common}
          value={String(value)}
          options={(prop.options ?? []).map((o) => o.replace(/^['"]|['"]$/g, ''))}
          commit={(v) => commit(v)}
        />
      );
    default:
      // `string`, and the two reference shapes — a `#id` and an asset path are both text a
      // person types, and the compiler is what checks them.
      return <TextRow {...common} value={String(value)} commit={(v) => commit(v)} />;
  }
}

/**
 * The node's identity: whether it is on, and what it is called — one row, as Unity has it.
 *
 * `active` is written **only when false**. A document that says nothing is active, so writing
 * `active="true"` would pin today's default into the file for no gain; unticking and re-ticking
 * therefore leaves the document exactly as it was found.
 */
function IdentityRow({
  id,
  active,
  setId,
  setActive,
}: {
  id: string;
  active: boolean;
  setId: (value: string) => void;
  setActive: (value: boolean) => void;
}): React.JSX.Element {
  const [text, setText] = useState(id);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(id);
  }, [id]);
  return (
    <div className={styles.identity}>
      <input
        type="checkbox"
        className={styles.toggle}
        checked={active}
        title="Active — off turns the whole subtree off"
        onChange={(e) => setActive(e.target.checked)}
      />
      <input
        type="text"
        className={cx(styles.input, styles.identityId)}
        value={text}
        placeholder="id"
        title="A typed field on the generated class, and what #id refers to"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          if (text !== id) setId(text.trim());
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

/** A gizmo drag and a typed number take the same path: read the live object, write the document. */
function commitVector(
  doc: SceneDocument | undefined,
  node: Object3D,
  channel: 'position' | 'eulerAngles' | 'scale',
  value: number[],
  opts?: { coalesce?: boolean },
): void {
  const target = channel === 'eulerAngles' ? node.eulerAngles : node[channel];
  target.set(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  if (channel === 'eulerAngles') node.eulerAngles = target;
  doc?.setTransform(node, channel, opts);
}

function fmtVec(values: number[]): string {
  return values.map((n) => Math.round(n * 1000) / 1000).join(', ');
}

/** The "+ Add component" row, which opens the picker. */
function AddRow({ node }: { node: Object3D }): React.JSX.Element {
  const openAdd = useUI((s) => s.openAdd);
  return (
    <button type="button" className={styles.addRow} onClick={() => openAdd(node)}>
      <Plus />
      Add component
    </button>
  );
}

/**
 * Per-member actions.
 *
 * Only delete, for now: the compiler can reorder elements, but a component's order in a
 * `<Components>` block does not change what it does, so there is nothing to reorder *for*.
 */
function MemberActions({ onDelete }: { onDelete: () => void }): React.JSX.Element {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation(); // the header itself toggles the fold
    fn();
  };
  return (
    <button
      type="button"
      className={cx(styles.memberBtn, styles.memberDelete)}
      title="Delete"
      aria-label="Delete"
      onClick={stop(onDelete)}
    >
      <Trash2 />
    </button>
  );
}

/** What the document writes, and everything else — the inspector's ordering everywhere. */
function split<T>(items: readonly T[], written: (item: T) => boolean): { written: T[]; rest: T[] } {
  return { written: items.filter(written), rest: items.filter((i) => !written(i)) };
}

/** One attached object's own attributes — the inline material a mesh draws with. */
function AttachmentSection({
  attachment,
  editable,
  doc,
}: {
  attachment: Attachment;
  editable: boolean;
  doc: SceneDocument | undefined;
}): React.JSX.Element {
  const render = (prop: PropInfo): React.JSX.Element => (
    <PropRow
      key={prop.name}
      prop={prop}
      written={attachment.attributes.get(prop.name)}
      editable={editable}
      commit={(v, c) => doc?.setAttachmentValue(attachment, prop, v, c)}
      clear={() => doc?.setAttachmentValue(attachment, prop, null)}
    />
  );
  const props = split([...attachment.tag.parameters, ...attachment.tag.properties], (p) =>
    attachment.attributes.get(p.name) !== undefined,
  );
  return (
    <Section title={`<${attachment.tag.name}>`} description={`This node's own ${attachment.slot}.`}>
      {props.written.map(render)}
      {props.rest.length > 0 ? (
        <Section title={`${props.rest.length} more on <${attachment.tag.name}>`} startClosed>
          {props.rest.map(render)}
        </Section>
      ) : null}
    </Section>
  );
}

function Section({
  title,
  description,
  actions,
  startClosed,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Folded on first sight — for the "…more" groups nobody opened deliberately. */
  startClosed?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const [, force] = useReducer((x: number) => x + 1, 0);
  if (startClosed && !seenSections.has(title)) {
    seenSections.add(title);
    closedSections.add(title);
  }
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

/**
 * What a component actually holds for one field, as text a locked row can show.
 *
 * Undefined for anything an attribute could not have written in the first place — a live physics
 * body, a texture — where the honest row is the name and the lock, not `[object Object]`.
 */
function liveText(target: object, name: string): string | undefined {
  const value = (target as Record<string, unknown>)[name];
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return String(value);
  const v = value as {
    isColor?: boolean;
    isVector2?: boolean;
    isVector3?: boolean;
    x?: number;
    y?: number;
    z?: number;
    getHexString?: () => string;
  };
  if (v.isColor) return `#${v.getHexString?.() ?? ''}`;
  if (v.isVector3) return `x: ${v.x}; y: ${v.y}; z: ${v.z}`;
  if (v.isVector2) return `x: ${v.x}; y: ${v.y}`;
  return undefined;
}
