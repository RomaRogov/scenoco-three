import type {
  DocumentKindInfo,
  DocumentShape,
  ElementAt,
  PropInfo,
  SncElement,
} from '@scenoco-three/compiler/browser';
import { parseDocument } from '@scenoco-three/compiler/browser';
import { EditLog } from './editLog.js';
import type { Edit } from './document.js';
import { formatValue, type Scalar } from './values.js';

/**
 * One element of a config document, however it got there.
 *
 * The form asks the same questions of an element written in the file and of one added a moment
 * ago and not yet saved, so both arrive as this. What separates them is `at`: an element the file
 * already holds has a position every edit is addressed by, and an added one has none until the
 * save puts it there.
 */
export interface ConfigNode {
  /** The element's name, which is the name of the type it fills. */
  name: string;
  shape: DocumentShape;
  attributes: ReadonlyMap<string, string>;
  /** Where it stands in the file as opened, or null for one added since. */
  at: ElementAt | null;
  /** Added elements only: the block a save will insert. */
  pending?: PendingElement;
}

/** An element added since the document was opened, held as a tree until it is written. */
class PendingElement {
  readonly name: string;
  readonly shape: DocumentShape;
  readonly attributes = new Map<string, string>();
  readonly children: PendingElement[] = [];

  constructor(shape: DocumentShape) {
    this.name = shape.name;
    this.shape = shape;
  }

  /** The XML a save inserts — the whole subtree, because it goes in as one splice. */
  xml(indent = ''): string {
    const attributes = [...this.attributes]
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join('');
    if (this.children.length === 0) return `${indent}<${this.name}${attributes} />`;
    const inner = this.children.map((child) => child.xml(`${indent}  `)).join('\n');
    return `${indent}<${this.name}${attributes}>\n${inner}\n${indent}</${this.name}>`;
  }
}

/**
 * A document that is one typed value rather than a tree of nodes — a `.particle.xml`.
 *
 * There is no scene to show, so there is nothing to pick and nothing to drag: the document *is*
 * the interface. What it may say comes from the model the build left behind, where a package's
 * own type arrived as data — the root element, every child element, every attribute and its
 * shape. Nothing here knows about particles, or about any other kind.
 *
 * It sits beside {@link SceneDocument} and shares its machinery: the same splices, the same undo
 * log, the same save. What differs is only what an element *means*.
 */
export class ConfigDocument {
  /** Project-relative path — what a save writes back to. */
  readonly path: string;
  /** The kind this document is, and the shape of everything it may say. */
  readonly kind: DocumentKindInfo;

  private text: string;
  private parsed: SncElement | null = null;
  private readonly log = new EditLog();

  /**
   * Pending changes, as an overlay on the opened text rather than as new text.
   *
   * Every edit is addressed by where its element stood **when the document was opened** — that is
   * what `applyEdits` resolves against, and it is the only position that stays true while other
   * splices move the lines around it. So the file is never re-derived here; what a person sees is
   * the opened document plus what they have changed.
   */
  private readonly attrs = new Map<string, Map<string, string | null>>();
  private readonly removed = new Set<string>();
  /** Added elements, by the key of the element they were added to. */
  private readonly added = new Map<string, Array<{ element: PendingElement; edit: Edit }>>();

  constructor(path: string, text: string, kind: DocumentKindInfo) {
    this.path = path;
    this.text = text;
    this.kind = kind;
    const result = parseDocument(text, path);
    this.parsed = result.ok ? result.root : null;
  }

  /** Why this document cannot be shown as a form, if it cannot. */
  get problem(): string | null {
    if (!this.kind.shape) {
      return `"${this.kind.module}" declares ${this.kind.extension} documents, but this project has not read its type. Run \`scenoco build\`.`;
    }
    if (!this.parsed) return `${this.path} is not valid XML.`;
    if (this.parsed.tag !== this.kind.shape.name) {
      return `This document must be rooted at <${this.kind.shape.name}>, not <${this.parsed.tag}>.`;
    }
    return null;
  }

  /** The document itself, as the form's first element. */
  get root(): ConfigNode | null {
    return this.kind.shape && this.parsed && !this.problem ? this.nodeOf(this.parsed, this.kind.shape) : null;
  }

  // --- reading ------------------------------------------------------------------------------

  /**
   * The child elements of `node` for one field, in document order then pending order.
   *
   * One rule finds them: an element is named by the type of the field it fills, so a `<Burst>` is
   * whatever `bursts: Burst[]` holds. A group field has at most one; a list field has as many as
   * the document writes.
   */
  childrenOf(node: ConfigNode, shape: DocumentShape): ConfigNode[] {
    const written = node.pending
      ? node.pending.children.filter((child) => child.name === shape.name).map((child) => this.pendingNode(child))
      : (this.elementAt(node.at)?.children ?? [])
          .filter((child) => child.tag === shape.name && !this.removed.has(key(child)))
          .map((child) => this.nodeOf(child, shape));
    const extra = (this.added.get(nodeKey(node)) ?? [])
      .filter(({ element }) => element.name === shape.name)
      .map(({ element }) => this.pendingNode(element));
    return [...written, ...extra];
  }

  /** What the document says for one attribute — including a change not yet saved. */
  value(node: ConfigNode, prop: PropInfo): string | undefined {
    const pending = node.at ? this.attrs.get(key(node.at))?.get(prop.name) : undefined;
    if (pending !== undefined) return pending ?? undefined;
    return node.attributes.get(prop.name);
  }

  // --- writing ------------------------------------------------------------------------------

  /** Write an attribute, or take it out of the file with `null`. */
  setValue(node: ConfigNode, prop: PropInfo, value: Scalar | null, opts?: { coalesce?: boolean }): void {
    const text = value === null ? null : formatValue(prop.shape, value);
    const label = `${node.name}.${prop.name}`;

    if (node.pending) {
      const before = node.pending.attributes.get(prop.name);
      this.change(
        label,
        () => {
          if (text === null) node.pending!.attributes.delete(prop.name);
          else node.pending!.attributes.set(prop.name, text);
          this.rewrite(node.pending!);
        },
        () => {
          if (before === undefined) node.pending!.attributes.delete(prop.name);
          else node.pending!.attributes.set(prop.name, before);
          this.rewrite(node.pending!);
        },
        opts?.coalesce ?? false,
      );
      return;
    }

    const at = node.at!;
    const previous = this.attrs.get(key(at))?.get(prop.name);
    this.change(
      label,
      () => {
        this.overlay(at).set(prop.name, text);
        this.log.replaceAttribute({ op: 'setAttribute', at, name: prop.name, value: text });
      },
      () => {
        if (previous === undefined) this.overlay(at).delete(prop.name);
        else this.overlay(at).set(prop.name, previous);
        this.requeue(at, prop.name, previous);
      },
      opts?.coalesce ?? false,
    );
  }

  /** Add a child element — a module the document has not written, or one more of a repeatable one. */
  add(parent: ConfigNode, shape: DocumentShape): void {
    const element = new PendingElement(shape);
    if (parent.pending) {
      const owner = parent.pending;
      const top = this.topLevel(owner);
      this.change(
        `add <${shape.name}>`,
        () => {
          owner.children.push(element);
          this.rewrite(owner);
        },
        () => {
          owner.children.splice(owner.children.indexOf(element), 1);
          if (top) this.rewrite(owner);
        },
        false,
      );
      return;
    }

    const at = parent.at!;
    const edit: Edit = { op: 'insertChild', at, xml: element.xml() };
    const entry = { element, edit };
    this.change(
      `add <${shape.name}>`,
      () => {
        const into = this.added.get(key(at)) ?? [];
        into.push(entry);
        this.added.set(key(at), into);
        this.log.queue(edit);
      },
      () => {
        const into = this.added.get(key(at)) ?? [];
        into.splice(into.indexOf(entry), 1);
        this.log.unqueue(edit);
      },
      false,
    );
  }

  /** Take a child element out again. */
  remove(node: ConfigNode): void {
    if (node.pending) {
      const owner = this.ownerOf(node.pending);
      if (owner === null) return;
      if (owner === 'top') {
        const found = [...this.added].flatMap(([k, list]) => list.map((entry) => [k, entry] as const))
          .find(([, entry]) => entry.element === node.pending);
        if (!found) return;
        const [parentKey, entry] = found;
        this.change(
          `remove <${node.name}>`,
          () => {
            const into = this.added.get(parentKey)!;
            into.splice(into.indexOf(entry), 1);
            this.log.unqueue(entry.edit);
          },
          () => {
            this.added.get(parentKey)!.push(entry);
            this.log.queue(entry.edit);
          },
          false,
        );
        return;
      }
      const index = owner.children.indexOf(node.pending);
      this.change(
        `remove <${node.name}>`,
        () => {
          owner.children.splice(index, 1);
          this.rewrite(owner);
        },
        () => {
          owner.children.splice(index, 0, node.pending!);
          this.rewrite(owner);
        },
        false,
      );
      return;
    }

    const at = node.at!;
    const edit: Edit = { op: 'removeElement', at };
    this.change(
      `remove <${node.name}>`,
      () => {
        this.removed.add(key(at));
        this.log.queue(edit);
      },
      () => {
        this.removed.delete(key(at));
        this.log.unqueue(edit);
      },
      false,
    );
  }

  // --- the surface the toolbar drives --------------------------------------------------------

  get canUndo(): boolean {
    return this.log.canUndo;
  }
  get canRedo(): boolean {
    return this.log.canRedo;
  }
  get isDirty(): boolean {
    return this.log.isDirty;
  }
  edits(): readonly Edit[] {
    return this.log.edits;
  }
  undoLast(): void {
    this.log.undo();
  }
  redoLast(): void {
    this.log.redo();
  }
  onChange(listener: () => void): () => void {
    return this.log.onChange(listener);
  }

  /** The file has been written: the saved text is the new baseline. */
  markSaved(text: string): void {
    this.text = text;
    const result = parseDocument(text, this.path);
    this.parsed = result.ok ? result.root : null;
    this.attrs.clear();
    this.removed.clear();
    this.added.clear();
    this.log.clear();
  }

  // --- internals ----------------------------------------------------------------------------

  private nodeOf(element: SncElement, shape: DocumentShape): ConfigNode {
    return { name: element.tag, shape, attributes: element.attributes, at: { line: element.line, column: element.column } };
  }

  private pendingNode(element: PendingElement): ConfigNode {
    return { name: element.name, shape: element.shape, attributes: element.attributes, at: null, pending: element };
  }

  /** The element at a position in the document as opened. */
  private elementAt(at: ElementAt | null): SncElement | undefined {
    if (!at || !this.parsed) return undefined;
    const find = (element: SncElement): SncElement | undefined => {
      if (element.line === at.line && element.column === at.column) return element;
      for (const child of element.children) {
        const found = find(child);
        if (found) return found;
      }
      return undefined;
    };
    return find(this.parsed);
  }

  private overlay(at: ElementAt): Map<string, string | null> {
    const existing = this.attrs.get(key(at));
    if (existing) return existing;
    const created = new Map<string, string | null>();
    this.attrs.set(key(at), created);
    return created;
  }

  /** Put the pending write back to what it was, or take it out when there was none. */
  private requeue(at: ElementAt, name: string, previous: string | null | undefined): void {
    const pending = this.log.edits.find(
      (e) => e.op === 'setAttribute' && e.at.line === at.line && e.at.column === at.column && e.name === name,
    );
    if (pending) this.log.unqueue(pending);
    if (previous !== undefined) this.log.replaceAttribute({ op: 'setAttribute', at, name, value: previous });
  }

  /** Which pending element holds this one: its parent, `'top'` for one inserted into the file. */
  private ownerOf(element: PendingElement): PendingElement | 'top' | null {
    const search = (current: PendingElement): PendingElement | null => {
      if (current.children.includes(element)) return current;
      for (const child of current.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    for (const list of this.added.values()) {
      for (const entry of list) {
        if (entry.element === element) return 'top';
        const found = search(entry.element);
        if (found) return found;
      }
    }
    return null;
  }

  /** The inserted block `element` belongs to, so its XML can be written again. */
  private topLevel(element: PendingElement): { element: PendingElement; edit: Edit } | undefined {
    const holds = (current: PendingElement): boolean =>
      current === element || current.children.some(holds);
    for (const list of this.added.values()) {
      const found = list.find((entry) => holds(entry.element));
      if (found) return found;
    }
    return undefined;
  }

  /** An added block changed: the one splice that inserts it carries the whole subtree. */
  private rewrite(element: PendingElement): void {
    const top = this.topLevel(element);
    if (top && top.edit.op === 'insertChild') top.edit.xml = top.element.xml();
  }

  private change(label: string, apply: () => void, revert: () => void, coalesce: boolean): void {
    this.log.commit(label, apply, revert, coalesce);
  }
}

const key = (at: ElementAt): string => `${at.line}:${at.column}`;
const nodeKey = (node: ConfigNode): string => (node.at ? key(node.at) : 'pending');

/** `"` and `&` are the two that would break an attribute; the rest is legal as written. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
