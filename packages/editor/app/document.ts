import type { Object3D, Vector3 } from 'three';
import { provenanceOf, type Provenance } from '@scenoco-three/core';
import type { ComponentInfo, ElementAt, ProjectModel, PropInfo, TagInfo, ValueShape } from '@scenoco-three/compiler';
import { indexDocument, setAttribute } from '@scenoco-three/compiler/browser';
import { EditLog } from './editLog.js';
import type { Resolve } from './live/build.js';
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
  /** The node whose slot holds it, and where in that slot when the slot is a list. */
  owner: Object3D;
  ordinal: number;
  at: ElementAt;
  attributes: ReadonlyMap<string, string>;
}

/**
 * One component, as the document writes it: an element inside a node's `<Components>`.
 *
 * Read from the text, never from a live instance. The editor runs nothing, so there is no
 * instance to read — and what a person edits is the element anyway.
 */
export interface ComponentEntry {
  /** The node it is on — what a preview of it hangs under. */
  node: Object3D;
  /** The element name, which is the class name: all a document says about the class. */
  tag: string;
  /** What the build read from the class, or undefined when this project's model does not know it. */
  info: ComponentInfo | undefined;
  /** The attributes as written. */
  attributes: ReadonlyMap<string, string>;
  /** An element of the file as opened, or one added since, which exists only in its pending insert. */
  readonly source: { at: ElementAt } | { added: Added };
}

/** A component added since the file was opened. Its text is the insert that will write it. */
interface Added {
  tag: string;
  attributes: Map<string, string>;
  block: PendingBlock;
}

/**
 * The components added to one node, and the single insert that writes them.
 *
 * One insert per node rather than one per component: a node with no `<Components>` gets the block
 * with its first component, and a second insert would write a second block.
 */
interface PendingBlock {
  members: Added[];
  /** Into the node itself, wrapped in a new `<Components>`, or into the block it already has. */
  wrap: boolean;
  edit: Extract<Edit, { op: 'insertChild' }>;
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

  /**
   * Something about a node's components changed, so whatever is drawn from them is stale.
   *
   * Assigned by the page rather than taken in the constructor, the way the session's own hooks
   * are: the document knows an edit happened and nothing about what an editor draws.
   */
  onComponentEdit?: (node: Object3D) => void;

  /** Turns the text of a reference into what it names; without one, a reference edit waits for a rebuild. */
  private readonly resolve: Resolve | undefined;
  /** The latest write to each live field, so a reference that resolves late cannot undo a newer one. */
  private readonly writes = new WeakMap<object, Map<string, number>>();
  /** Components added since opening, by the node they were added to (`line:column`). */
  private readonly added = new Map<string, PendingBlock>();
  /** Components of the file as opened that a pending edit removes (`line:column`). */
  private readonly removed = new Set<string>();

  constructor(path: string, text: string, elements: readonly RawElement[], model: ProjectModel, resolve?: Resolve) {
    this.path = path;
    this.text = text;
    this.model = model;
    this.resolve = resolve;
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

    const found: Attachment[] = [];
    const filled = new Map<string, number>();
    for (const element of this.childrenOf(parent)) {
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
      found.push({ tag, slot: slot.name, live, owner: node, ordinal, at: element.at, attributes: element.attributes });
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
    const params = (attachment.live as { parameters?: Record<string, unknown> }).parameters;
    if (params && attachment.tag.parameters.some((p) => p.name === prop.name)) {
      // A geometry *is* its constructor: three reads `radius` once, keeps the vertices, and
      // records the arguments in `parameters`. So an edit to one builds a new geometry from those
      // arguments and puts it in the slot, and undo puts the old one back.
      const previous = attachment.live;
      const Built = previous.constructor as new (...args: unknown[]) => object;
      const next = new Built(
        ...attachment.tag.parameters.map((p) =>
          p.name !== prop.name ? params[p.name] : text === null ? undefined : parseValue(p.shape, text),
        ),
      );
      this.log.commit(
        `${prop.name} on <${attachment.tag.name}>`,
        () => {
          this.writeAttribute(attachment.at, prop.name, text);
          fillSlot(attachment, next);
        },
        () => {
          this.writeAttribute(attachment.at, prop.name, before);
          fillSlot(attachment, previous);
        },
        opts?.coalesce === true,
      );
      return;
    }
    const live = snapshot(attachment.live, prop.name, prop.shape);
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

  /**
   * The components a node's element declares, in document order, each with what the build read
   * from its class — then the ones added since the file was opened.
   *
   * A spawned prefab has none here: its components are declared in the prefab's own file.
   */
  componentsOf(node: Object3D): ComponentEntry[] {
    if (!this.canEditComponents(node)) return [];
    const info = (tag: string) => this.model.components.find((c) => c.name === tag);
    const block = this.componentsBlockOf(node);
    const written: ComponentEntry[] = (block ? this.childrenOf(block) : [])
      .filter((e) => !this.removed.has(keyOf(e.at)))
      .map((e) => ({ node, tag: e.tag, info: info(e.tag), attributes: e.attributes, source: { at: e.at } }));
    const added = this.added.get(keyOf(this.mine(node)!))?.members ?? [];
    return [
      ...written,
      ...added.map((a) => ({ node, tag: a.tag, info: info(a.tag), attributes: a.attributes, source: { added: a } })),
    ];
  }

  /** The elements directly inside one — not those inside a node nested in it. */
  private childrenOf(parent: ElementView): ElementView[] {
    const inside = this.elements.filter((e) => e !== parent && e.start > parent.start && e.end <= parent.end);
    return inside.filter(
      (element) => !inside.some((other) => other !== element && other.start < element.start && element.end <= other.end),
    );
  }

  componentProp(entry: ComponentEntry, name: string): string | undefined {
    return entry.attributes.get(name);
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

  setNodeValue(node: Object3D, prop: PropInfo, value: Scalar, opts?: { coalesce?: boolean }): void {
    this.setNodeAttr(node, prop.name, formatValue(prop.shape, value), { ...opts, shape: prop.shape });
  }

  setComponentValue(entry: ComponentEntry, prop: PropInfo, value: Scalar, opts?: { coalesce?: boolean }): void {
    this.setComponentProp(entry, prop.name, formatValue(prop.shape, value), opts);
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
    const live = opts?.from ?? snapshot(node, attr, opts?.shape);
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

  /**
   * Set or clear one of a component's attributes. The document is all there is: nothing runs in
   * the editor, so there is no live component to write through to.
   */
  setComponentProp(entry: ComponentEntry, name: string, value: string | null, opts?: { coalesce?: boolean }): void {
    const before = entry.attributes.get(name) ?? null;
    const write = (text: string | null): void => {
      if ('at' in entry.source) return this.writeAttribute(entry.source.at, name, text);
      // Not in the file yet: the attribute goes into the insert that will write it.
      const { added } = entry.source;
      if (text === null) added.attributes.delete(name);
      else added.attributes.set(name, text);
      rewriteBlock(added.block);
    };
    this.log.commit(`${name} on <${entry.tag}>`, () => write(value), () => write(before), opts?.coalesce === true);
    this.onComponentEdit?.(entry.node);
  }

  clearComponentProp(entry: ComponentEntry, name: string): void {
    this.setComponentProp(entry, name, null);
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

  /** Add a component to a node — a `<Type />` inside its `<Components>`, which comes with it if need be. */
  addComponent(node: Object3D, type: string): void {
    const at = this.mine(node);
    if (!at || !this.canEditComponents(node)) return;
    const key = keyOf(at);
    const existing = this.componentsBlockOf(node);
    const block: PendingBlock = this.added.get(key) ?? {
      members: [],
      wrap: !existing,
      edit: { op: 'insertChild', at: existing?.at ?? at, xml: '' },
    };
    const member: Added = { tag: type, attributes: new Map(), block };
    this.log.commit(
      `add <${type}>`,
      () => this.attach(key, member, block.members.length),
      () => this.detach(key, member),
      false,
    );
  }

  removeComponent(entry: ComponentEntry): void {
    const { source } = entry;
    if ('added' in source) {
      const key = [...this.added].find(([, block]) => block === source.added.block)?.[0];
      if (key === undefined) return;
      const index = source.added.block.members.indexOf(source.added);
      this.log.commit(
        `remove <${entry.tag}>`,
        () => this.detach(key, source.added),
        () => this.attach(key, source.added, index),
        false,
      );
      return;
    }
    const edit: Edit = { op: 'removeElement', at: source.at };
    this.log.commit(
      `remove <${entry.tag}>`,
      () => {
        this.log.queue(edit);
        this.removed.add(keyOf(source.at));
      },
      () => {
        this.log.unqueue(edit);
        this.removed.delete(keyOf(source.at));
      },
      false,
    );
  }

  /** Put an added component back into its node's pending block, queuing the block's insert with the first. */
  private attach(key: string, member: Added, index: number): void {
    const { block } = member;
    if (block.members.length === 0) {
      this.added.set(key, block);
      this.log.queue(block.edit);
    }
    block.members.splice(index, 0, member);
    rewriteBlock(block);
  }

  private detach(key: string, member: Added): void {
    const { block } = member;
    block.members.splice(block.members.indexOf(member), 1);
    if (block.members.length > 0) return rewriteBlock(block);
    this.added.delete(key);
    this.log.unqueue(block.edit);
  }

  /** The node's own `<Components>` — a direct child, wherever it sits among the node's other children. */
  private componentsBlockOf(node: Object3D): ElementView | undefined {
    const owner = this.elementOf(node);
    return owner ? this.childrenOf(owner).find((e) => e.tag === 'Components') : undefined;
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
    const token = (this.writes.get(target)?.get(name) ?? 0) + 1;
    this.writes.set(target, (this.writes.get(target) ?? new Map()).set(name, token));
    if (text === null || shape === undefined) return restore(target, name, fallback, shape);
    if (REFERENCE.has(shape)) {
      // The text names the object; it is not the object. Written as it stands, a mesh's geometry
      // became a string and the next frame threw. So it is resolved the way the scene was built
      // — the shared asset from the same cache — and put on only if no newer write came first.
      void this.resolve?.(name, shape, text).then((resolved) => {
        if (resolved === undefined || this.writes.get(target)?.get(name) !== token) return;
        (target as Record<string, unknown>)[name] = resolved;
      });
      return;
    }
    const value = parseValue(shape, text);
    if (value === undefined) return restore(target, name, fallback, shape);
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
    this.added.clear();
    this.removed.clear();
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

/** Shapes whose text names something else — a file, a constant — rather than spelling a value. */
const REFERENCE = new Set<ValueShape>(['assetRef', 'enum']);

/**
 * The live value of one attribute, detached so a later mutation cannot change it.
 *
 * A reference is kept as the reference: a material is cloneable, and restoring a clone with
 * `copy` would write this node's old look into a material every other node shares.
 */
function snapshot(target: object, name: string, shape?: ValueShape): unknown {
  const value = (target as Record<string, unknown>)[name];
  if (shape && REFERENCE.has(shape)) return value;
  const cloneable = value as { clone?: () => unknown } | null;
  return cloneable && typeof cloneable.clone === 'function' ? cloneable.clone() : value;
}

function keyOf(at: ElementAt): string {
  return `${at.line}:${at.column}`;
}

/**
 * Write a pending block's insert from its members, through the compiler's own attribute splice so
 * a value is escaped exactly as a save of an existing element would escape it.
 */
function rewriteBlock(block: PendingBlock): void {
  const elements = block.members.map((member) => {
    let xml = `<${member.tag} />`;
    for (const [name, value] of member.attributes) xml = setAttribute(xml, indexDocument(xml)[0]!, name, value).text;
    return xml;
  });
  block.edit.xml = block.wrap
    ? `<Components>\n${elements.map((e) => `  ${e}`).join('\n')}\n</Components>`
    : elements.join('\n');
}

/** Put an object in the slot an attachment fills — the nth entry, when the slot is a list. */
function fillSlot(attachment: Attachment, thing: object): void {
  const owner = attachment.owner as unknown as Record<string, unknown>;
  const held = owner[attachment.slot];
  if (Array.isArray(held)) held[attachment.ordinal] = thing;
  else owner[attachment.slot] = thing;
}

/** Put a snapshot back where it came from. */
function restore(target: object, name: string, snap: unknown, shape?: ValueShape): void {
  const current = (target as Record<string, unknown>)[name] as { copy?: (v: unknown) => void } | null;
  const whole = ASSIGN_WHOLE.has(name) || (shape !== undefined && REFERENCE.has(shape));
  if (!whole && current && snap && typeof current.copy === 'function') {
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
