import type { DocumentShape, ElementAt, PropInfo } from '@scenoco-three/compiler/browser';
import { indexDocument, setAttribute } from '@scenoco-three/compiler/browser';
import type { Edit } from './document.js';
import type { EditLog } from './editLog.js';
import type { Scalar } from './values.js';

/**
 * One element as text, through the compiler's own attribute splice — so a value written here is
 * escaped exactly as a save of an element the file already holds would escape it.
 */
export function elementXml(name: string, attributes: ReadonlyMap<string, string>): string {
  let xml = `<${name} />`;
  for (const [attribute, value] of attributes) {
    xml = setAttribute(xml, indexDocument(xml)[0]!, attribute, value).text;
  }
  return xml;
}

/**
 * One element of a config, however it got there.
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

/**
 * An element added since the document was opened, held as a tree until it is written.
 *
 * A tree because a config nests: adding `<Emission>` and then a `<Burst>` inside it are two edits
 * to one thing, and that thing is written by a single splice.
 */
export class PendingElement {
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
    const open = elementXml(this.name, this.attributes);
    if (this.children.length === 0) return `${indent}${open}`;
    const inner = this.children.map((child) => child.xml(`${indent}  `)).join('\n');
    return `${indent}${open.replace(/\s*\/>$/, '>')}\n${inner}\n${indent}</${this.name}>`;
  }
}

/**
 * The elements added to one document since it was opened, and the inserts that will write them.
 *
 * Apart from either document class because **both** need it: a `.particle.xml` is a config from
 * its root down, and a scene holds one inside the component that uses it. Everything that does not
 * depend on *where* an element sits lives here, operations included — two copies of this would be
 * two trees that can disagree.
 */
export class PendingStore {
  /** Added elements, by the key of the element they were added to. */
  private readonly added = new Map<string, Array<{ element: PendingElement; edit: Edit }>>();
  private readonly log: EditLog;
  /** Roots written by someone else's splice, and how to write them again. */
  private readonly foreign = new Map<PendingElement, () => void>();

  constructor(log: EditLog) {
    this.log = log;
  }

  /** The added children of one element, in the order they were added. */
  childrenOf(key: string, name: string): PendingElement[] {
    return (this.added.get(key) ?? []).filter((entry) => entry.element.name === name).map((e) => e.element);
  }

  /** Everything added to one element, whatever it is called. */
  allChildrenOf(key: string): PendingElement[] {
    return (this.added.get(key) ?? []).map((entry) => entry.element);
  }

  /** Write an attribute on an element that is not in the file yet. */
  setAttribute(element: PendingElement, name: string, text: string | null, coalesce: boolean): void {
    const before = element.attributes.get(name);
    const put = (value: string | undefined): void => {
      if (value === undefined) element.attributes.delete(name);
      else element.attributes.set(name, value);
      this.rewrite(element);
    };
    this.log.commit(
      `${element.name}.${name}`,
      () => put(text ?? undefined),
      () => put(before),
      coalesce,
    );
  }

  /** Add a child element to the file, at `at` — the element that will hold it. */
  addTo(at: ElementAt, shape: DocumentShape, index?: number): void {
    const element = new PendingElement(shape);
    const edit: Edit = {
      op: 'insertChild',
      at,
      xml: element.xml(),
      ...(index !== undefined ? { index } : {}),
    };
    const entry = { element, edit };
    const key = keyOfAt(at);
    this.log.commit(
      `add <${shape.name}>`,
      () => {
        this.added.set(key, [...(this.added.get(key) ?? []), entry]);
        this.log.queue(edit);
      },
      () => {
        const rest = (this.added.get(key) ?? []).filter((e) => e !== entry);
        if (rest.length === 0) this.added.delete(key);
        else this.added.set(key, rest);
        this.log.unqueue(edit);
      },
      false,
    );
  }

  /**
   * Take charge of an element whose insert belongs to something else — a config written inside a
   * component added this session, where the splice is the `<Components>` block's. Without it the
   * store could not write such a subtree again after an edit.
   */
  adopt(element: PendingElement, rewrite: () => void): void {
    this.foreign.set(element, rewrite);
  }

  /** Give one back — it has been taken out of whatever held it. */
  disown(element: PendingElement): void {
    this.foreign.delete(element);
  }

  /** Add a child to an element that is itself not written yet: one splice carries both. */
  addWithin(parent: PendingElement, shape: DocumentShape): void {
    const element = new PendingElement(shape);
    this.log.commit(
      `add <${shape.name}>`,
      () => {
        parent.children.push(element);
        this.rewrite(parent);
      },
      () => {
        parent.children.splice(parent.children.indexOf(element), 1);
        this.rewrite(parent);
      },
      false,
    );
  }

  /** Take an added element out again, wherever in the pending tree it sits. */
  remove(element: PendingElement): void {
    const owner = this.ownerOf(element);
    if (owner === null) return; // an adopted root: whoever holds it takes it out
    if (owner === 'top') {
      const found = this.entryOf(element);
      if (!found) return;
      const { key, entry } = found;
      const index = (this.added.get(key) ?? []).indexOf(entry);
      this.log.commit(
        `remove <${element.name}>`,
        () => {
          this.added.set(key, (this.added.get(key) ?? []).filter((e) => e !== entry));
          this.log.unqueue(entry.edit);
        },
        () => {
          const list = [...(this.added.get(key) ?? [])];
          list.splice(index, 0, entry);
          this.added.set(key, list);
          this.log.queue(entry.edit);
        },
        false,
      );
      return;
    }
    const index = owner.children.indexOf(element);
    this.log.commit(
      `remove <${element.name}>`,
      () => {
        owner.children.splice(index, 1);
        this.rewrite(owner);
      },
      () => {
        owner.children.splice(index, 0, element);
        this.rewrite(owner);
      },
      false,
    );
  }

  private entryOf(element: PendingElement): { key: string; entry: { element: PendingElement; edit: Edit } } | undefined {
    for (const [key, list] of this.added) {
      const entry = list.find((e) => e.element === element);
      if (entry) return { key, entry };
    }
    return undefined;
  }

  /** Which pending element holds this one: its parent, or `'top'` for one inserted into the file. */
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
    for (const root of this.foreign.keys()) {
      if (root === element) return null; // an adopted root: its holder takes it out
      const found = search(root);
      if (found) return found;
    }
    return null;
  }

  /** An added block changed: the one splice that inserts it carries the whole subtree. */
  private rewrite(element: PendingElement): void {
    const holds = (current: PendingElement): boolean =>
      current === element || current.children.some(holds);
    for (const list of this.added.values()) {
      const top = list.find((entry) => holds(entry.element));
      if (top && top.edit.op === 'insertChild') {
        top.edit.xml = top.element.xml();
        return;
      }
    }
    for (const [root, write] of this.foreign) if (holds(root)) return write();
  }

  clear(): void {
    this.added.clear();
    this.foreign.clear();
  }
}

/**
 * What the config form needs of whatever document holds the config.
 *
 * The form is the same for a `.particle.xml` open on its own and for an effect written inside a
 * `<ParticleSystem>`, because an element means the same thing in both. This is all that differs:
 * where the elements are and how an edit is addressed.
 */
export interface ConfigHost {
  childrenOf(node: ConfigNode, shape: DocumentShape): ConfigNode[];
  /** What the document says for one attribute, including a change not yet saved. */
  value(node: ConfigNode, prop: PropInfo): string | undefined;
  setValue(node: ConfigNode, prop: PropInfo, value: Scalar | null, opts?: { coalesce?: boolean }): void;
  add(parent: ConfigNode, shape: DocumentShape): void;
  remove(node: ConfigNode): void;
}

/**
 * An element as a plain tree — what a value is read from, wherever it came from. A parsed
 * document, the scene's own index and a just-added element all answer these three questions.
 */
export interface ConfigElement {
  tag: string;
  attributes: ReadonlyMap<string, string>;
  children: readonly ConfigElement[];
}

/** One pending element as that tree. */
export function elementOf(element: PendingElement): ConfigElement {
  return { tag: element.name, attributes: element.attributes, children: element.children.map(elementOf) };
}

/** A node for an element the file already holds. */
export function writtenNode(
  element: { tag: string; attributes: ReadonlyMap<string, string> },
  at: ElementAt,
  shape: DocumentShape,
): ConfigNode {
  return { name: element.tag, shape, attributes: element.attributes, at };
}

/** A node for one added since, which lives only in its pending insert. */
export function pendingNode(element: PendingElement): ConfigNode {
  return { name: element.name, shape: element.shape, attributes: element.attributes, at: null, pending: element };
}

export const keyOfAt = (at: ElementAt): string => `${at.line}:${at.column}`;
export const keyOfNode = (node: ConfigNode): string => (node.at ? keyOfAt(node.at) : 'pending');
