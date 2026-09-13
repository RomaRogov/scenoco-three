import type { Object3D, Vector3 } from 'three';
import { provenanceOf, type Component, type Provenance } from '@scenoco-three/core';
import type { ComponentInfo, ElementAt, ProjectModel, PropInfo, TagInfo, ValueShape } from '@scenoco-three/compiler';
import { EditLog } from './editLog.js';
import { formatValue, parseValue, type Scalar } from './values.js';

/** A pending change, in the shape the server splices. */
export type Edit =
  | { op: 'setAttribute'; at: ElementAt; name: string; value: string | null }
  | { op: 'removeElement'; at: ElementAt }
  | { op: 'insertChild'; at: ElementAt; xml: string; index?: number }
  | { op: 'moveElement'; at: ElementAt; parent: ElementAt; index?: number };

/** The three placement channels a gizmo drives. */
export type TransformChannel = 'position' | 'eulerAngles' | 'scale';

/** One element of the open document, as the inspector needs it. */
/** One object a node is built from, as written inside the node's own element. */
export interface Attachment {
  tag: TagInfo;
  /** The constructor slot it fills, which is also the property it lands on — `material`. */
  slot: string;
  /** The object the compiler built from it, so an edit shows without waiting for a rebuild. */
  live: object;
  at: ElementAt;
  attributes: ReadonlyMap<string, string>;
}

interface ElementView {
  tag: string;
  at: ElementAt;
  /** Byte range of the whole element in the document text — what a copy lifts. */
  start: number;
  end: number;
  attributes: Map<string, string>;
}

/**
 * The open document, and every change made to it since it was opened.
 *
 * The source **is** the model. A node knows which element built it, because the compiler stamped
 * it; an edit is a splice addressed by that stamp; the file on disk is the only state. So this
 * class holds the document text, the element index, and a list of pending splices.
 *
 * Edits are also applied to the live objects immediately, which is not redundant: the round trip
 * through the server and a rebuild takes long enough to feel wrong under a gizmo drag, and an
 * inspector that only updated after a save would be unusable.
 */
export class SceneDocument {
  /** Project-relative path — and the `file` every editable node is stamped with. */
  readonly path: string;

  private text: string;
  private readonly model: ProjectModel;
  private elements: ElementView[] = [];
  /** What has changed since the document was opened, and how to take it back. */
  private readonly log = new EditLog();

  constructor(path: string, text: string, elements: readonly RawElement[], model: ProjectModel) {
    this.path = path;
    this.text = text;
    this.model = model;
    this.adopt(elements);
  }

  // --- what may be edited ------------------------------------------------------------------

  /**
   * Where this node came from, or null if nothing authored it.
   *
   * Null covers two cases that look the same from here and are both correctly read-only: a node
   * some component spawned at runtime, and a node from a *different* document — the inside of a
   * spawned prefab, which is stamped with the prefab's own file.
   */
  originOf(node: Object3D): Provenance | null {
    return provenanceOf(node);
  }

  /** True when this node belongs to the document being edited. */
  private mine(node: Object3D): ElementAt | null {
    const origin = provenanceOf(node);
    if (!origin || origin.file !== this.path) return null;
    return { line: origin.line, column: origin.column };
  }

  canEditTransform(node: Object3D): boolean {
    return this.mine(node) !== null;
  }

  /**
   * Whether this document can *declare* components on a node — what an "Add component" needs.
   *
   * A spawned prefab cannot take one. The compiler skips a `<Prefab>` element's children when it
   * walks a document for components, so a `<Components>` block written inside one compiles to
   * nothing: the button would appear to work and change nothing, which is worse than not
   * offering it. The prefab's own file is where its components are declared.
   */
  canEditComponents(node: Object3D): boolean {
    return this.mine(node) !== null && this.tagNameOf(node) !== 'Prefab';
  }

  /**
   * Whether *this* document declares the component, as opposed to a prefab it spawns.
   *
   * A prefab instance is the case that needs it: the `<Prefab>` element is in this file, so the
   * node is ours and its placement is editable — but the components came with the prefab and are
   * declared in that file. Asking the node is the wrong question, and answering it with the node
   * gave an inspector full of live-looking fields whose writes went nowhere: `setComponentProp`
   * finds no element and returns, so typing into them did nothing at all.
   */
  canEditComponent(component: Component): boolean {
    return this.componentElement(component) !== undefined;
  }

  canEditStructure(node: Object3D): boolean {
    return this.mine(node) !== null;
  }

  /** The document a node came from, when it is not this one — what to open to edit it. */
  foreignSource(node: Object3D): string | null {
    const origin = provenanceOf(node);
    return origin && origin.file !== this.path ? origin.file : null;
  }

  // --- reading -----------------------------------------------------------------------------

  /** The element that built this node. */
  private elementOf(node: Object3D): ElementView | undefined {
    const at = this.mine(node);
    if (!at) return undefined;
    return this.elements.find((e) => e.at.line === at.line && e.at.column === at.column);
  }

  /** What the document says for one of a node's attributes, or undefined if it says nothing. */
  nodeAttr(node: Object3D, attr: string): string | undefined {
    return this.elementOf(node)?.attributes.get(attr);
  }

  /** True when the document writes this attribute — as opposed to leaving it at its default. */
  isNodeAttrSet(node: Object3D, attr: string): boolean {
    return this.nodeAttr(node, attr) !== undefined;
  }

  /** The element name the document wrote — `Panel`, not `Mesh`. */
  tagNameOf(node: Object3D): string | undefined {
    return this.elementOf(node)?.tag;
  }

  /** The tag the compiler knows this node's element by, with its authorable attributes. */
  tagOf(node: Object3D): TagInfo | undefined {
    const tag = this.elementOf(node)?.tag;
    return tag ? this.model.tags.find((t) => t.name === tag) : undefined;
  }

  /**
   * The objects this node is built *from* — a geometry or a material written inside its element
   * rather than named as a file.
   *
   * They are not nodes, so nothing in the tree selects them; the inspector shows them under the
   * node whose constructor takes them.
   */
  attachmentsOf(node: Object3D): Attachment[] {
    const parent = this.elementOf(node);
    const parentTag = this.tagOf(node);
    if (!parent || !parentTag) return [];

    const inside = this.elements.filter((e) => e !== parent && e.start > parent.start && e.end <= parent.end);
    const found: Attachment[] = [];
    const filled = new Map<string, number>();
    for (const element of inside) {
      // Anything nested deeper belongs to a node between here and there, not to this one.
      if (inside.some((other) => other !== element && other.start < element.start && element.end <= other.end)) {
        continue;
      }
      const tag = this.model.tags.find((t) => t.name === element.tag);
      if (!tag || tag.family === 'node') continue;
      const slot = parentTag.parameters.find((p) => p.assetFamily === tag.family);
      if (!slot) continue;

      const ordinal = filled.get(slot.name) ?? 0;
      filled.set(slot.name, ordinal + 1);
      // The slot's name is the property it lands on, so `material` reaches `mesh.material` —
      // or its nth entry, for a mesh whose slots are a list.
      const held = (node as unknown as Record<string, unknown>)[slot.name];
      const live = Array.isArray(held) ? held[ordinal] : held;
      if (typeof live !== 'object' || live === null) continue;
      found.push({ tag, slot: slot.name, live, at: element.at, attributes: element.attributes });
    }
    return found;
  }

  attachmentValue(attachment: Attachment, prop: PropInfo): Scalar | undefined {
    return parseValue(prop.shape, attachment.attributes.get(prop.name));
  }

  setAttachmentValue(
    attachment: Attachment,
    prop: PropInfo,
    value: Scalar | null,
    opts?: { coalesce?: boolean },
  ): void {
    const text = value === null ? null : formatValue(prop.shape, value);
    const before = attachment.attributes.get(prop.name) ?? null;
    const live = snapshot(attachment.live, prop.name);
    this.log.commit(
      `${prop.name} on <${attachment.tag.name}>`,
      () => {
        this.writeAttribute(attachment.at, prop.name, text);
        this.applyLive(attachment.live, prop.name, text, prop.shape, live);
      },
      () => {
        this.writeAttribute(attachment.at, prop.name, before);
        this.applyLive(attachment.live, prop.name, before, prop.shape, live);
      },
      opts?.coalesce === true,
    );
  }

  /** The components on a node, paired with what the compiler knows about each class. */
  componentsOf(node: Object3D): Array<{ component: Component; info: ComponentInfo | undefined }> {
    return node.components.map((component) => ({
      component,
      info: this.model.components.find((c) => c.name === component.constructor.name),
    }));
  }

  /** The element of one component — the Nth `<Type>` inside this node's `<Components>`. */
  private componentElement(component: Component): ElementView | undefined {
    const owner = this.elementOf(component.object3D);
    if (!owner) return undefined;
    const name = component.constructor.name;
    const ordinal = component.object3D.components
      .filter((c) => c.constructor.name === name)
      .indexOf(component);
    // Elements are in document order, so the components of a node are the ones that follow it
    // before the next node's element — and the Nth of a name is the Nth match.
    const start = this.elements.indexOf(owner);
    const matches = this.elements.slice(start + 1).filter((e) => e.tag === name);
    return matches[ordinal];
  }

  componentProp(component: Component, name: string): string | undefined {
    return this.componentElement(component)?.attributes.get(name);
  }

  isComponentPropSet(component: Component, name: string): boolean {
    return this.componentProp(component, name) !== undefined;
  }

  /**
   * One attribute as a **value**, for the inspector's widgets.
   *
   * The document stores text and the widgets edit numbers, flags and axis lists; this pair is the
   * only place the two meet, so a scrubbed number and a hand-typed one land in the file the same
   * way. Undefined when the document does not write it — which is what the row needs in order to
   * show the default, greyed.
   */
  nodeValue(node: Object3D, prop: PropInfo): Scalar | undefined {
    return parseValue(prop.shape, this.nodeAttr(node, prop.name));
  }

  componentValue(component: Component, prop: PropInfo): Scalar | undefined {
    return parseValue(prop.shape, this.componentProp(component, prop.name));
  }

  setNodeValue(node: Object3D, prop: PropInfo, value: Scalar, opts?: { coalesce?: boolean }): void {
    this.setNodeAttr(node, prop.name, formatValue(prop.shape, value), { ...opts, shape: prop.shape });
  }

  setComponentValue(
    component: Component,
    prop: PropInfo,
    value: Scalar,
    opts?: { coalesce?: boolean },
  ): void {
    this.setComponentProp(component, prop.name, formatValue(prop.shape, value), {
      ...opts,
      shape: prop.shape,
    });
  }

  // --- writing -----------------------------------------------------------------------------

  /**
   * Set or clear one of a node's own attributes.
   *
   * `null` clears it, which is a real instruction rather than "write the default": a document
   * that says nothing inherits whatever the class decides later, and one that writes the current
   * default is pinned to today's value.
   */
  setNodeAttr(
    node: Object3D,
    attr: string,
    value: string | null,
    opts?: { coalesce?: boolean; shape?: ValueShape; from?: unknown },
  ): void {
    const at = this.mine(node);
    if (!at) return;
    const before = this.nodeAttr(node, attr) ?? null;
    // `from` when the caller knows the value from before the change — a gizmo does, because the
    // drag it is reporting has already moved the object. Sampling here would be a frame late.
    const live = opts?.from ?? snapshot(node, attr);
    this.log.commit(
      `${attr} on <${this.elementOf(node)?.tag ?? '?'}>`,
      () => {
        this.writeAttribute(at, attr, value);
        this.applyLive(node, attr, value, opts?.shape, live);
      },
      () => {
        this.writeAttribute(at, attr, before);
        this.applyLive(node, attr, before, opts?.shape, live);
      },
      opts?.coalesce === true,
    );
  }

  clearNodeAttr(node: Object3D, attr: string): void {
    this.setNodeAttr(node, attr, null);
  }

  setComponentProp(
    component: Component,
    name: string,
    value: string | null,
    opts?: { coalesce?: boolean; shape?: ValueShape },
  ): void {
    const element = this.componentElement(component);
    if (!element) return;
    const before = element.attributes.get(name) ?? null;
    const live = snapshot(component, name);
    this.log.commit(
      `${name} on <${element.tag}>`,
      () => {
        this.writeAttribute(element.at, name, value);
        this.applyLive(component, name, value, opts?.shape, live);
      },
      () => {
        this.writeAttribute(element.at, name, before);
        this.applyLive(component, name, before, opts?.shape, live);
      },
      opts?.coalesce === true,
    );
  }

  clearComponentProp(component: Component, name: string): void {
    this.setComponentProp(component, name, null);
  }

  /**
   * Write a transform channel from the live object — what a gizmo drag commits.
   *
   * In the document's own units, so `eulerAngles` is degrees, and in the document's own grammar,
   * so a vector is `x: 1; y: 2; z: 3`. A gizmo produces a great many of these, which is what
   * `coalesce` is for: one drag is one undo step.
   */
  setTransform(
    node: Object3D,
    channel: TransformChannel,
    opts?: { coalesce?: boolean; from?: Vector3 },
  ): void {
    const vector = channel === 'eulerAngles' ? node.eulerAngles : node[channel];
    this.setNodeAttr(node, channel, formatVector(vector.x, vector.y, vector.z), {
      ...opts,
      shape: channel === 'eulerAngles' ? 'euler' : 'vector3',
      // Cloned: the gizmo reuses one vector per channel across drags, and this one has to hold
      // still inside an undo step for as long as the step exists.
      ...(opts?.from ? { from: opts.from.clone() } : {}),
    });
  }

  setVisible(node: Object3D, value: boolean): void {
    node.visible = value;
    this.setNodeAttr(node, 'visible', String(value));
  }

  /** Delete a node's element, and everything under it. */
  removeNode(node: Object3D): void {
    const at = this.mine(node);
    if (!at) return;
    this.log.push({ op: 'removeElement', at }, `remove <${this.elementOf(node)?.tag ?? 'node'}>`);
  }

  /** Reparent — what a drag in the tree produces. */
  moveNode(node: Object3D, newParent: Object3D, index?: number): void {
    const at = this.mine(node);
    const parent = this.mine(newParent);
    if (!at || !parent) return;
    this.log.push(
      { op: 'moveElement', at, parent, ...(index !== undefined ? { index } : {}) },
      `move <${this.elementOf(node)?.tag ?? 'node'}>`,
    );
  }

  /**
   * The source text of a node's element — what a copy puts on the clipboard.
   *
   * The authored text, not a re-serialization of the live objects: a paste should reproduce what
   * was written, comments and formatting and all, and anything reconstructed from the runtime
   * would have lost both.
   */
  sourceOf(node: Object3D): string | null {
    const element = this.elementOf(node);
    return element ? this.text.slice(element.start, element.end) : null;
  }

  /** Paste a fragment under a node. */
  insertNode(parent: Object3D, xml: string): void {
    const at = this.mine(parent);
    if (!at) return;
    this.log.push({ op: 'insertChild', at, xml }, 'paste');
  }

  /** Add a component to a node — a `<Type />` inside its `<Components>`. */
  addComponent(node: Object3D, type: string): void {
    const at = this.mine(node);
    if (!at) return;
    const components = this.componentsBlockOf(node);
    if (components) {
      this.log.push({ op: 'insertChild', at: components.at, xml: `<${type} />` }, `add <${type}>`);
      return;
    }
    // No `<Components>` yet, so the block comes with it.
    this.log.push(
      { op: 'insertChild', at, xml: `<Components>\n  <${type} />\n</Components>` },
      `add <${type}>`,
    );
  }

  removeComponent(component: Component): void {
    const element = this.componentElement(component);
    if (!element) return;
    this.log.push({ op: 'removeElement', at: element.at }, `remove <${element.tag}>`);
  }

  private componentsBlockOf(node: Object3D): ElementView | undefined {
    const owner = this.elementOf(node);
    if (!owner) return undefined;
    const start = this.elements.indexOf(owner);
    const next = this.elements[start + 1];
    return next?.tag === 'Components' ? next : undefined;
  }

  // --- the edit log ------------------------------------------------------------------------
  //
  // Kept by `EditLog`; the document supplies the pair of closures that make each step and takes
  // it back. Everything below is the document's side of that contract.

  /**
   * Make the live scene agree with what the document now says about one attribute.
   *
   * The document is the model and the scene is the view, and until this existed nothing carried
   * the model back to the view: typing a position in the inspector rewrote the XML and left the
   * object where it was, and undoing a gizmo drag rewound the file while the object stayed
   * dragged. Every write goes through here, so an edit, an undo and a redo all land the same
   * way — which is the only reason undo can be trusted.
   *
   * `fallback` is the value the object had before this edit, used when the document has nothing
   * left to say (the attribute was cleared, or was never authored). The class's own default is
   * the more principled answer and is not knowable here: it lives in the compiled scene, and
   * reading it back would mean rebuilding the node.
   */
  private applyLive(
    target: object,
    name: string,
    text: string | null,
    shape: ValueShape | undefined,
    fallback: unknown,
  ): void {
    if (text === null || shape === undefined) return restore(target, name, fallback);
    const value = parseValue(shape, text);
    if (value === undefined) return restore(target, name, fallback);
    write(target, name, value);
  }

  /** Queue the splice, and keep this document's own view of the element in step with it. */
  private writeAttribute(at: ElementAt, name: string, value: string | null): void {
    this.log.replaceAttribute({ op: 'setAttribute', at, name, value });

    const element = this.elements.find((e) => e.at.line === at.line && e.at.column === at.column);
    if (!element) return;
    if (value === null) element.attributes.delete(name);
    else element.attributes.set(name, value);
  }

  get canUndo(): boolean {
    return this.log.canUndo;
  }

  get canRedo(): boolean {
    return this.log.canRedo;
  }

  get isDirty(): boolean {
    return this.log.isDirty;
  }

  /** Everything not yet written to disk. */
  edits(): readonly Edit[] {
    return this.log.edits;
  }

  undoLast(): void {
    this.log.undo();
  }

  redoLast(): void {
    this.log.redo();
  }

  /** Called once the server has written the file. */
  markSaved(text: string, elements: readonly RawElement[]): void {
    this.text = text;
    this.log.clear();
    this.adopt(elements);
    this.log.emit();
  }

  onChange(listener: () => void): () => void {
    return this.log.onChange(listener);
  }

  /**
   * Take the element index the server built.
   *
   * Not parsed here on purpose. The positions have to be **the same numbers** the compiler
   * stamped into the live objects, and the only way to guarantee that is for one parser to
   * produce both. A second implementation in the browser drifted on the first long open tag it
   * met, and the symptom — some nodes selectable and some not — pointed nowhere near the cause.
   */
  private adopt(elements: readonly RawElement[]): void {
    this.elements = elements.map((e) => ({
      tag: e.tag,
      at: { line: e.line, column: e.column },
      start: e.start,
      end: e.end,
      attributes: new Map(Object.entries(e.attributes)),
    }));
  }
}

/** One element, as the server's index reports it. */
export interface RawElement {
  tag: string;
  line: number;
  column: number;
  start: number;
  end: number;
  attributes: Record<string, string>;
}

/** The default a document leaves unwritten, as the compiler read it from the source. */
export function defaultOf(prop: PropInfo): string | undefined {
  return prop.default;
}

/** `x: 1; y: 2; z: 3` — the DSL's only vector spelling. */
export function formatVector(x: number, y: number, z: number): string {
  const round = (n: number): string => String(Math.round(n * 1000) / 1000);
  return `x: ${round(x)}; y: ${round(y)}; z: ${round(z)}`;
}


// --- the live half of an edit -----------------------------------------------------------------

/**
 * `eulerAngles` hands back a cached vector that is recomputed from `rotation` on every read, so
 * writing *into* it sets a field the next read discards. Assigning the whole vector goes through
 * the setter, which is the documented way to use it — and the reason this needs naming at all.
 */
const ASSIGN_WHOLE = new Set(['eulerAngles']);

/** The live value of one attribute, detached so a later mutation cannot change it. */
function snapshot(target: object, name: string): unknown {
  const value = (target as Record<string, unknown>)[name];
  const cloneable = value as { clone?: () => unknown } | null;
  return cloneable && typeof cloneable.clone === 'function' ? cloneable.clone() : value;
}

/** Put a snapshot back where it came from. */
function restore(target: object, name: string, snap: unknown): void {
  const current = (target as Record<string, unknown>)[name] as { copy?: (v: unknown) => void } | null;
  if (!ASSIGN_WHOLE.has(name) && current && snap && typeof current.copy === 'function') {
    current.copy(snap);
    return;
  }
  (target as Record<string, unknown>)[name] = snap;
}

/** Write a parsed attribute value onto the live object, in whatever form the field takes. */
function write(target: object, name: string, value: Scalar): void {
  const current = (target as Record<string, unknown>)[name] as
    | { set?: (...args: number[]) => void; copy?: unknown }
    | null;

  if (Array.isArray(value)) {
    // A vector or an Euler. Assign a fresh one where the field aliases, otherwise write in place
    // so anything holding a reference to it — three does, everywhere — sees the change.
    if (ASSIGN_WHOLE.has(name) && current && typeof current.set === 'function') {
      const fresh = (current as { clone(): { set(...args: number[]): unknown } }).clone();
      fresh.set(...value);
      (target as Record<string, unknown>)[name] = fresh;
      return;
    }
    if (current && typeof current.set === 'function') {
      current.set(...value);
      return;
    }
  }
  // A colour is a number here, and `Color.set` takes one; everything else is a plain field.
  if (typeof value === 'number' && current && typeof current.set === 'function') {
    current.set(value);
    return;
  }
  (target as Record<string, unknown>)[name] = value;
}
