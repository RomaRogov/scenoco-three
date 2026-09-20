import type { Object3D, Vector3 } from 'three';
import { provenanceOf, type Provenance } from '@scenoco-three/core';
import type {
  ComponentInfo,
  DocumentShape,
  ElementAt,
  ProjectModel,
  PropInfo,
  SerializedField,
  TagInfo,
  ValueShape,
} from '@scenoco-three/compiler';
import { EditLog } from './editLog.js';
import {
  PendingElement,
  elementXml,
  PendingStore,
  elementOf,
  keyOfAt,
  keyOfNode,
  pendingNode,
  writtenNode,
  type ConfigElement,
  type ConfigHost,
  type ConfigNode,
} from './configTree.js';
import type { Construct, Resolve } from './live/build.js';
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
  /** Where it stands in the file as opened, or null for one added since. */
  at: ElementAt | null;
  attributes: ReadonlyMap<string, string>;
  /** Added since the file was opened: its text is the insert that will write it. */
  added?: AddedAttachment;
}

/**
 * An object added to a node's slot and not yet saved — the attachment counterpart of {@link Added},
 * there for the same reason: what a person sees has to include what they have just done.
 */
interface AddedAttachment {
  tag: TagInfo;
  slot: string;
  attributes: Map<string, string>;
  /** The object built for it, which is already in the node's slot. */
  live: object;
  /** What the slot held before — what an undo puts back. */
  before: unknown;
  edit: Extract<Edit, { op: 'insertChild' }>;
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
  /** Configs written inside it since — an effect given to a `<ParticleSystem>` added a moment ago. */
  children: PendingElement[];
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
export class SceneDocument implements ConfigHost {
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
  /** Builds an attached object that has just been added; without one, it shows on the next rebuild. */
  private readonly construct: Construct | undefined;
  /** The latest write to each live field, so a reference that resolves late cannot undo a newer one. */
  private readonly writes = new WeakMap<object, Map<string, number>>();
  /** Components added since opening, by the node they were added to (`line:column`). */
  private readonly added = new Map<string, PendingBlock>();
  /** Geometry and material added since opening, by the same key. */
  private readonly addedAttachments = new Map<string, AddedAttachment[]>();
  /** Components of the file as opened that a pending edit removes (`line:column`). */
  private readonly removed = new Set<string>();
  /** Config elements added since opening — an effect written inside a `<ParticleSystem>`. */
  private readonly addedConfigs = new PendingStore(this.log);
  /** Every attribute as the file had it on open, so a change back to it is not a change. */
  private readonly opened = new Map<string, Map<string, string>>();

  constructor(
    path: string,
    text: string,
    elements: readonly RawElement[],
    model: ProjectModel,
    live?: { resolve?: Resolve; construct?: Construct },
  ) {
    this.path = path;
    this.text = text;
    this.model = model;
    this.resolve = live?.resolve;
    this.construct = live?.construct;
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
    for (const element of this.elementsIn(parent)) {
      if (this.removed.has(keyOfAt(element.at))) continue;
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
    // Then what has been added since, which the file does not say yet.
    for (const added of this.addedAttachments.get(keyOfAt(parent.at)) ?? []) {
      found.push({
        tag: added.tag,
        slot: added.slot,
        live: added.live,
        owner: node,
        ordinal: 0,
        at: null,
        attributes: added.attributes,
        added,
      });
    }
    return found;
  }

  /**
   * The slots this node is built from: the constructor parameters that take an object.
   *
   * `Mesh` has two, `geometry` and `material`; a light has none. Read from three's own signature,
   * which is the same question the compiler asks when it decides where a child element goes.
   */
  slotsOf(node: Object3D): PropInfo[] {
    return (this.tagOf(node)?.parameters ?? []).filter((p) => p.assetFamily !== undefined);
  }

  /**
   * Give this node its own geometry or material, where it had none.
   *
   * Only where it had none: "one more" would be authoring a list, which the document can express
   * and a form has no good way to. Undo puts back exactly what the slot held.
   */
  async addAttachment(node: Object3D, tagName: string): Promise<void> {
    const at = this.mine(node);
    const tag = this.model.tags.find((t) => t.name === tagName);
    if (!at || !tag || !this.construct) return;
    const slot = (this.tagOf(node)?.parameters ?? []).find((p) => p.assetFamily === tag.family);
    if (!slot) return;

    // Built before the commit, so undo needs to wait for nothing.
    const live = await this.construct(tag);
    const added: AddedAttachment = {
      tag,
      slot: slot.name,
      attributes: new Map(),
      live,
      before: (node as unknown as Record<string, unknown>)[slot.name],
      // First child: what a node is made of reads before what hangs under it.
      edit: { op: 'insertChild', at, xml: `<${tag.name} />`, index: 0 },
    };
    const key = keyOfAt(at);
    this.log.commit(
      `add <${tag.name}>`,
      () => {
        this.addedAttachments.set(key, [...(this.addedAttachments.get(key) ?? []), added]);
        (node as unknown as Record<string, unknown>)[slot.name] = live;
        this.log.queue(added.edit);
      },
      () => {
        const rest = (this.addedAttachments.get(key) ?? []).filter((a) => a !== added);
        if (rest.length === 0) this.addedAttachments.delete(key);
        else this.addedAttachments.set(key, rest);
        (node as unknown as Record<string, unknown>)[slot.name] = added.before;
        this.log.unqueue(added.edit);
      },
      false,
    );
  }

  /** Take one out again, and put back whatever the slot held before it. */
  async removeAttachment(attachment: Attachment): Promise<void> {
    if (attachment.added) {
      const added = attachment.added;
      const key = [...this.addedAttachments].find(([, list]) => list.includes(added))?.[0];
      if (key === undefined) return;
      const index = this.addedAttachments.get(key)!.indexOf(added);
      this.log.commit(
        `remove <${added.tag.name}>`,
        () => {
          this.addedAttachments.set(key, this.addedAttachments.get(key)!.filter((a) => a !== added));
          (attachment.owner as unknown as Record<string, unknown>)[added.slot] = added.before;
          this.log.unqueue(added.edit);
        },
        () => {
          const list = [...this.addedAttachments.get(key)!];
          list.splice(index, 0, added);
          this.addedAttachments.set(key, list);
          (attachment.owner as unknown as Record<string, unknown>)[added.slot] = added.live;
          this.log.queue(added.edit);
        },
        false,
      );
      return;
    }

    const at = attachment.at;
    if (!at) return;
    // What the node would hold had the element never been there — three's own answer, read off a
    // throwaway of the same tag rather than from a table of defaults here.
    const parentTag = this.tagOf(attachment.owner);
    const fallback =
      parentTag && this.construct
        ? ((await this.construct(parentTag)) as Record<string, unknown>)[attachment.slot]
        : undefined;
    const previous = attachment.live;
    const edit: Edit = { op: 'removeElement', at };
    this.log.commit(
      `remove <${attachment.tag.name}>`,
      () => {
        this.removed.add(keyOfAt(at));
        this.log.queue(edit);
        if (fallback !== undefined) fillSlot(attachment, fallback as object);
      },
      () => {
        this.removed.delete(keyOfAt(at));
        this.log.unqueue(edit);
        fillSlot(attachment, previous);
      },
      false,
    );
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
    // Where the attribute goes: into the file as opened, or into the insert that has not run yet.
    const write = (written: string | null): void => {
      if (attachment.at) return this.writeAttribute(attachment.at, prop.name, written);
      const { added } = attachment;
      if (!added) return;
      if (written === null) added.attributes.delete(prop.name);
      else added.attributes.set(prop.name, written);
      added.edit.xml = elementXml(added.tag.name, added.attributes);
    };
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
          write(text);
          fillSlot(attachment, next);
        },
        () => {
          write(before);
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
        write(text);
        this.applyLive(attachment.live, prop.name, text, prop.shape, live);
      },
      () => {
        write(before);
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
    const written: ComponentEntry[] = (block ? this.elementsIn(block) : [])
      .filter((e) => !this.removed.has(keyOfAt(e.at)))
      .map((e) => ({ node, tag: e.tag, info: info(e.tag), attributes: e.attributes, source: { at: e.at } }));
    const added = this.added.get(keyOfAt(this.mine(node)!))?.members ?? [];
    return [
      ...written,
      ...added.map((a) => ({ node, tag: a.tag, info: info(a.tag), attributes: a.attributes, source: { added: a } })),
    ];
  }

  // --- a config written inside a component --------------------------------------------------

  /**
   * The configs a component may hold, and what it writes for each.
   *
   * A field typed by a document kind is either a path naming a shared file or an element giving
   * this component its own. This finds the second, against the shape the `.particle.xml` form is
   * drawn from — the same one.
   */
  configsOf(entry: ComponentEntry): Array<{ prop: SerializedField; shape: DocumentShape; node: ConfigNode | null }> {
    const out: Array<{ prop: SerializedField; shape: DocumentShape; node: ConfigNode | null }> = [];
    for (const prop of entry.info?.fields ?? []) {
      if (!prop.document) continue;
      const shape = (this.model.documents ?? []).find((k) => k.shape?.name === prop.document)?.shape;
      if (!shape) continue;
      out.push({ prop, shape, node: this.configNodeOf(entry, shape) });
    }
    return out;
  }

  /**
   * The configs a component writes, as trees — what its preview is built from. A preview takes a
   * value rather than a file, so an edit to one written here shows on the next frame.
   */
  configElementsOf(entry: ComponentEntry): readonly ConfigElement[] {
    if ('added' in entry.source) return entry.source.added.children.map(elementOf);
    const view = this.viewAt(entry.source.at);
    return view ? this.treeOf(view).children : [];
  }

  /**
   * One element of the index with everything under it, pending elements at any depth included: an
   * effect just given a `<ColorOverLifetime>` has to look like one the file already said that about.
   */
  private treeOf(view: ElementView): ConfigElement {
    const written = this.elementsIn(view)
      .filter((child) => !this.removed.has(keyOfAt(child.at)))
      .map((child) => this.treeOf(child));
    const pending = this.addedConfigs.allChildrenOf(keyOfAt(view.at)).map(elementOf);
    return { tag: view.tag, attributes: view.attributes, children: [...written, ...pending] };
  }

  /** Give this component its own config, where it had none. */
  addConfig(entry: ComponentEntry, shape: DocumentShape): void {
    if ('at' in entry.source) return this.addedConfigs.addTo(entry.source.at, shape);
    const { added } = entry.source;
    const element = new PendingElement(shape);
    this.addedConfigs.adopt(element, () => rewriteBlock(added.block));
    this.log.commit(
      `add <${shape.name}>`,
      () => {
        added.children.push(element);
        rewriteBlock(added.block);
      },
      () => {
        added.children.splice(added.children.indexOf(element), 1);
        rewriteBlock(added.block);
      },
      false,
    );
  }

  // --- the config form, for a config a component holds ---------------------------------------

  childrenOf(node: ConfigNode, shape: DocumentShape): ConfigNode[] {
    const view = node.pending ? undefined : this.viewAt(node.at);
    const written = node.pending
      ? node.pending.children.filter((child) => child.name === shape.name).map(pendingNode)
      : (view ? this.elementsIn(view) : [])
          .filter((child) => child.tag === shape.name && !this.removed.has(keyOfAt(child.at)))
          .map((child) => writtenNode(child, child.at, shape));
    return [...written, ...this.addedConfigs.childrenOf(keyOfNode(node), shape.name).map(pendingNode)];
  }

  value(node: ConfigNode, prop: PropInfo): string | undefined {
    // The element index is written through on every edit, so what it holds is already current.
    return node.attributes.get(prop.name);
  }

  setValue(node: ConfigNode, prop: PropInfo, value: Scalar | null, opts?: { coalesce?: boolean }): void {
    const text = value === null ? null : formatValue(prop.shape, value);
    if (node.pending) this.addedConfigs.setAttribute(node.pending, prop.name, text, opts?.coalesce ?? false);
    else {
      const at = node.at!;
      const before = node.attributes.get(prop.name) ?? null;
      this.log.commit(
        `${node.name}.${prop.name}`,
        () => this.writeAttribute(at, prop.name, text),
        () => this.writeAttribute(at, prop.name, before),
        opts?.coalesce ?? false,
      );
    }
  }

  add(parent: ConfigNode, shape: DocumentShape): void {
    if (parent.pending) this.addedConfigs.addWithin(parent.pending, shape);
    else this.addedConfigs.addTo(parent.at!, shape);
  }

  remove(node: ConfigNode): void {
    if (node.pending) this.addedConfigs.remove(node.pending);
    else {
      const at = node.at!;
      const edit: Edit = { op: 'removeElement', at };
      this.log.commit(
        `remove <${node.name}>`,
        () => {
          this.removed.add(keyOfAt(at));
          this.log.queue(edit);
        },
        () => {
          this.removed.delete(keyOfAt(at));
          this.log.unqueue(edit);
        },
        false,
      );
    }
  }

  /** The element a component writes for one config field, written or pending. */
  private configNodeOf(entry: ComponentEntry, shape: DocumentShape): ConfigNode | null {
    if ('added' in entry.source) {
      const found = entry.source.added.children.find((child) => child.name === shape.name);
      return found ? pendingNode(found) : null;
    }
    const view = this.viewAt(entry.source.at);
    const written = view
      ? this.elementsIn(view).find((child) => child.tag === shape.name && !this.removed.has(keyOfAt(child.at)))
      : undefined;
    if (written) return writtenNode(written, written.at, shape);
    const pending = this.addedConfigs.childrenOf(keyOfAt(entry.source.at), shape.name)[0];
    return pending ? pendingNode(pending) : null;
  }

  private viewAt(at: ElementAt | null): ElementView | undefined {
    if (!at) return undefined;
    return this.elements.find((e) => e.at.line === at.line && e.at.column === at.column);
  }

  /**
   * The form's view of one component's config: the same edits, and the node they belong to.
   *
   * A scrubbed number has to reach whatever draws the node, and only the caller knows which node
   * the form it is drawing hangs under.
   */
  configHost(entry: ComponentEntry): ConfigHost {
    const notify = (): void => this.onComponentEdit?.(entry.node);
    return {
      childrenOf: (node, shape) => this.childrenOf(node, shape),
      value: (node, prop) => this.value(node, prop),
      setValue: (node, prop, value, opts) => {
        this.setValue(node, prop, value, opts);
        notify();
      },
      add: (node, shape) => {
        this.add(node, shape);
        notify();
      },
      remove: (node) => {
        this.remove(node);
        notify();
      },
    };
  }

  /** The elements directly inside one — not those inside a node nested in it. */
  private elementsIn(parent: ElementView): ElementView[] {
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
    const key = keyOfAt(at);
    const existing = this.componentsBlockOf(node);
    const block: PendingBlock = this.added.get(key) ?? {
      members: [],
      wrap: !existing,
      edit: { op: 'insertChild', at: existing?.at ?? at, xml: '' },
    };
    const member: Added = { tag: type, attributes: new Map(), children: [], block };
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
        this.removed.add(keyOfAt(source.at));
      },
      () => {
        this.log.unqueue(edit);
        this.removed.delete(keyOfAt(source.at));
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
    return owner ? this.elementsIn(owner).find((e) => e.tag === 'Components') : undefined;
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
    // Back to what the file says is not an edit: without this, undoing the last change left a
    // splice queued that rewrote the attribute with its own value and Save wrote a diff of nothing.
    const opened = this.opened.get(keyOfAt(at))?.get(name) ?? null;
    const queued = this.log.edits.find(
      (e) => e.op === 'setAttribute' && e.at.line === at.line && e.at.column === at.column && e.name === name,
    );
    if (value === opened) {
      if (queued) this.log.unqueue(queued);
    } else {
      this.log.replaceAttribute({ op: 'setAttribute', at, name, value });
    }

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
    this.addedAttachments.clear();
    this.addedConfigs.clear();
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
    this.opened.clear();
    for (const element of this.elements) this.opened.set(keyOfAt(element.at), new Map(element.attributes));
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

/** Write a pending block's insert from its members, each with whatever was written inside it. */
function rewriteBlock(block: PendingBlock): void {
  const elements = block.members.map((member) => {
    const xml = elementXml(member.tag, member.attributes);
    if (member.children.length === 0) return xml;
    const inner = member.children.map((child) => child.xml('  ')).join('\n');
    return `${xml.replace(/\s*\/>$/, '>')}\n${inner}\n</${member.tag}>`;
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
