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
import {
  PendingStore,
  keyOfAt,
  keyOfNode,
  pendingNode,
  writtenNode,
  type ConfigHost,
  type ConfigNode,
} from './configTree.js';
import { formatValue, type Scalar } from './values.js';

/**
 * A document that is one typed value rather than a tree of nodes — a `.particle.xml`.
 *
 * There is no scene to show, so there is nothing to pick and nothing to drag: the document *is*
 * the interface. What it may say comes from the model the build left behind, where a package's
 * own type arrived as data — the root element, every child element, every attribute and its
 * shape. Nothing here knows about particles, or about any other kind.
 *
 * It sits beside {@link SceneDocument} and shares its machinery: the same splices, the same undo
 * log, the same save, and — since a scene may hold one of these inside a component — the same
 * form and the same pending tree. What differs is only where the elements are.
 */
export class ConfigDocument implements ConfigHost {
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
  private readonly added = new PendingStore(this.log);

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
    if (!this.kind.shape || !this.parsed || this.problem) return null;
    return writtenNode(this.parsed, at(this.parsed), this.kind.shape);
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
      ? node.pending.children.filter((child) => child.name === shape.name).map(pendingNode)
      : (this.elementAt(node.at)?.children ?? [])
          .filter((child) => child.tag === shape.name && !this.removed.has(keyOfAt(at(child))))
          .map((child) => writtenNode(child, at(child), shape));
    return [...written, ...this.added.childrenOf(keyOfNode(node), shape.name).map(pendingNode)];
  }

  /** What the document says for one attribute — including a change not yet saved. */
  value(node: ConfigNode, prop: PropInfo): string | undefined {
    const pending = node.at ? this.attrs.get(keyOfAt(node.at))?.get(prop.name) : undefined;
    if (pending !== undefined) return pending ?? undefined;
    return node.attributes.get(prop.name);
  }

  // --- writing ------------------------------------------------------------------------------

  /** Write an attribute, or take it out of the file with `null`. */
  setValue(node: ConfigNode, prop: PropInfo, value: Scalar | null, opts?: { coalesce?: boolean }): void {
    const text = value === null ? null : formatValue(prop.shape, value);
    if (node.pending) {
      this.added.setAttribute(node.pending, prop.name, text, opts?.coalesce ?? false);
      return;
    }

    const at = node.at!;
    const previous = this.attrs.get(keyOfAt(at))?.get(prop.name);
    this.log.commit(
      `${node.name}.${prop.name}`,
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
    if (parent.pending) this.added.addWithin(parent.pending, shape);
    else this.added.addTo(parent.at!, shape);
  }

  /** Take a child element out again. */
  remove(node: ConfigNode): void {
    if (node.pending) return this.added.remove(node.pending);

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
    const existing = this.attrs.get(keyOfAt(at));
    if (existing) return existing;
    const created = new Map<string, string | null>();
    this.attrs.set(keyOfAt(at), created);
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
}

/** Where an element of the parse stands, in the shape every edit is addressed by. */
const at = (element: SncElement): ElementAt => ({ line: element.line, column: element.column });
