/** Changes to attributes, live and unsaved, undone and redone, and written by Save. */
import type { EditHost } from '@scenoco-three/core';
import type { Address, ArgPlace, Args, Attr } from './types.js';
import { keyOf, type SceneFiles, sourceKey } from './server.js';
import { itemText, read, same, shown, toFile, toLive } from './values.js';

/** The file does not write the attribute. */
const UNWRITTEN = Symbol('unwritten');

/** An attribute exactly as the file writes it — `{-Math.PI / 2}`, null for a bare flag — to put back word for word. */
class Text {
  readonly text: string | null;
  /** A constant the text names, which the file must import. */
  readonly import?: { name: string; from: string };
  constructor(text: string | null, imports?: { name: string; from: string }) {
    this.text = text;
    if (imports) this.import = imports;
  }
}

/** A change not saved yet: what Save writes. */
interface Unsaved {
  address: Address;
  name: string;
  targets: object[];
  /** As the live object takes it. */
  live: unknown;
  /** As the file is written with it: a value, its exact text, or UNWRITTEN to take it out. */
  file: unknown;
}

/** One side of a change: the value live, and as the file would say it. */
interface Side {
  live: unknown;
  file: unknown;
  /** For `args`: each item's text on this side. */
  items?: string[];
}

/** One change, to undo or redo. */
interface Step {
  /** Every object it sets: one, or each copy of a prefab. */
  targets: object[];
  name: string;
  /** A prop of a function's tag: see `Attr.prop`. */
  prop?: boolean;
  /** The attribute in its file — null for a change that stays live. */
  at: { key: string; address: Address } | null;
  before: Side;
  after: Side;
}

/**
 * Every change: made live at once, unsaved until Save writes it into its file, undone and redone in
 * between. A change remembers both sides — as the live object takes it and as the file says it — so
 * undoing it to what the file says leaves nothing to save.
 */
export class History {
  private readonly host: EditHost;
  private readonly files: SceneFiles;
  private readonly changed: () => void;
  private readonly say: (text: string, error?: boolean) => void;
  private readonly undos: Step[] = [];

  private redos: Step[] = [];

  private readonly unsaved = new Map<string, Unsaved>();

  /** What each changed attribute's file says now, as written: saving moves it. */
  private readonly inFile = new Map<string, unknown>();

  /** Each unsaved attribute's value, as shown, before its first change: what Reset puts back when the file has none. */
  private readonly before = new Map<string, unknown>();

  /** Each object's arguments since one was edited: until then, what its element gave. */
  private readonly args = new WeakMap<object, Args>();

  constructor(host: EditHost, files: SceneFiles, changed: () => void, say: (text: string, error?: boolean) => void) {
    this.host = host;
    this.files = files;
    this.changed = changed;
    this.say = say;
  }

  /** Whether an attribute, by its key, has a change Save would write. */
  isUnsaved(key: string): boolean {
    return this.unsaved.has(key);
  }

  /** An unsaved attribute's value, as shown, before its first change. */
  beforeOf(key: string): unknown {
    return this.before.get(key);
  }

  /** An object's arguments since one was edited, if one was. */
  argsOf(target: object): Args | undefined {
    return this.args.get(target);
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  /** How many changes Save would write. */
  get unsavedCount(): number {
    return this.unsaved.size;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** Everything an element made: one object, or — for a change made prefab-wide — every copy's. */
  targets(attr: { target: object; wide?: boolean; element?: string }): object[] {
    if (!attr.wide || !attr.element) return [attr.target];
    const { host } = this;
    const out: object[] = [];
    host.scene.traverse((n) => {
      // A copy's root answers for its tag; its own element, inside the prefab, is `own`.
      if (sourceKey(host.sourceOf(n)) === attr.element || sourceKey(host.own(n)?.source) === attr.element) out.push(n);
      for (const b of host.behavioursOn(n)) if (sourceKey(host.sourceOf(b)) === attr.element) out.push(b);
    });
    return out.length ? out : [attr.target];
  }

  /**
   * Set an attribute live. `done` ends a change — a typed value, a scrub let go — which then can be
   * undone and, when the element is a scene file's, is unsaved until Save. A scrub in progress
   * only sets it live. `before` is what undo puts back.
   */
  async set(attr: Attr, value: unknown, done: boolean, before: unknown = attr.value): Promise<void> {
    if (attr.locked) return;
    if (attr.arg) return this.setArg(attr, attr.arg, value, done, before);
    let live = toLive(value, attr.kind);
    const targets = this.targets(attr);
    for (const target of targets) this.host.apply(target, attr.name, live, attr.prop);
    if (!done) return this.changed();
    // What the object made of it — `onValidate` snapping it to a grid, clamping it — is what the file
    // gets, as a drag writes where the node ended up. A prop called the function again: nothing to read.
    if (!attr.prop && attr.kind && attr.kind !== 'option') {
      const now = read(this.host.current(targets[0]!), attr.name);
      const seen = now === undefined ? undefined : shown(now, attr.kind);
      // Compared as shown, both rounded alike: a value typed finer than the editor shows stays as typed.
      if (seen !== undefined && JSON.stringify(seen) !== JSON.stringify(shown(live, attr.kind))) {
        value = seen;
        live = toLive(value, attr.kind);
      }
    }
    const at = this.at(attr);
    const was = at && (this.unsaved.get(at.key)?.file ?? this.inFile.get(at.key));
    if (at && !this.unsaved.has(at.key)) this.before.set(at.key, before);
    // An option is written as the file names it — `{DoubleSide}`, imported if need be.
    const option = attr.options?.find((o) => o.value === value);
    const file = option ? new Text(option.text, option.import) : toFile(value, attr.kind);
    this.record({ targets, name: attr.name, prop: attr.prop, at, before: { live: toLive(before, attr.kind), file: was }, after: { live, file } });
  }

  /**
   * One argument changed: the live object takes the whole list again, and the file the list with
   * that one item's text replaced — or put back word for word, when the value is the file's again.
   */
  private setArg(attr: Attr, arg: ArgPlace, value: unknown, done: boolean, before: unknown): void {
    const { index, now, original } = arg;
    const list = now.list.map((v, i) => (i === index ? toLive(value, attr.kind) : v));
    const targets = this.targets(attr);
    for (const target of targets) this.host.apply(target, 'args', list);
    if (!done) {
      for (const target of targets) this.args.set(this.host.current(target), { list, items: now.items });
      return this.changed();
    }
    const option = attr.options?.find((o) => o.value === value);
    const text = same(value, attr.file) && original[index] !== undefined ? original[index]! : option ? option.text.replace(/^\{(.*)\}$/, '$1') : itemText(toFile(value, attr.kind), now.items[index]);
    const items = now.items.map((t, i) => (i === index ? text : t));
    const beforeList = now.list.map((v, i) => (i === index ? toLive(before, attr.kind) : v));
    const at = attr.at ? this.atArgs(attr.at, arg.whole) : null;
    const was = at && (this.unsaved.get(at.key)?.file ?? this.inFile.get(at.key));
    this.record({
      targets,
      name: 'args',
      at,
      before: { live: beforeList, file: was, items: now.items },
      after: { live: list, file: new Text(`{[${items.join(', ')}]}`), items },
    });
    this.changed();
  }

  /** Where `args` is written, first noting what its file says. */
  private atArgs(address: Address, whole: string | null): Step['at'] {
    const key = keyOf(address, 'args');
    if (!this.inFile.has(key)) this.inFile.set(key, new Text(whole));
    return { key, address };
  }

  /** Where an attribute is written, first noting what its file says. Null for one that stays live. */
  private at(attr: Attr): Step['at'] {
    const address = attr.at;
    if (!address) return null;
    const key = keyOf(address, attr.name);
    if (!this.inFile.has(key)) this.inFile.set(key, attr.written ? new Text(attr.text) : UNWRITTEN);
    return { key, address };
  }

  /** Put an attribute back to what the file says: an unsaved change is dropped, the game's own undone. */
  reset(attr: Attr): void {
    if (attr.source === undefined) return;
    if (attr.arg) return void this.set(attr, attr.source, true);
    const live = toLive(attr.source, attr.kind);
    const at = this.at(attr);
    const file = at && this.inFile.get(at.key);
    const was = at && (this.unsaved.get(at.key)?.file ?? file);
    const targets = this.targets(attr);
    for (const target of targets) this.host.apply(target, attr.name, live, attr.prop);
    this.record({ targets, name: attr.name, prop: attr.prop, at, before: { live: toLive(attr.value, attr.kind), file: was }, after: { live, file } });
  }

  /** Write every unsaved change into its file, one attribute each. */
  async save(): Promise<void> {
    let saved = 0;
    for (const [key, change] of [...this.unsaved]) {
      const { file } = change;
      const ok = await this.files.write(change.address, change.name, file === UNWRITTEN ? null : file instanceof Text ? { text: file.text, ...(file.import && { import: file.import }) } : { value: file });
      if (!ok) return;
      for (const target of change.targets) this.host.written(target, change.name, change.file === UNWRITTEN ? undefined : change.live);
      this.inFile.set(key, change.file);
      this.unsaved.delete(key);
      this.before.delete(key);
      saved++;
    }
    this.say(saved ? `Saved ${saved} ${saved === 1 ? 'change' : 'changes'}.` : 'Nothing to save.');
  }

  /** Forget what is unsaved: it stays live, and Save no longer writes it. */
  discard(): void {
    this.unsaved.clear();
    this.before.clear();
    this.changed();
  }

  private record(step: Step): void {
    this.apply(step, step.after);
    this.undos.push(step);
    this.redos = [];
  }

  /** A side of a change made current: unsaved unless the file says just that already. */
  private apply(step: Step, side: Side): void {
    if (side.items) for (const target of step.targets) this.args.set(this.host.current(target), { list: side.live as unknown[], items: side.items });
    if (step.at) {
      const { key, address } = step.at;
      if (same(side.file, this.inFile.get(key))) this.unsaved.delete(key);
      else this.unsaved.set(key, { address, name: step.name, targets: step.targets, live: side.live, file: side.file });
    }
    this.changed();
  }

  /** Undo and redo change the live values and what is unsaved; only Save writes a file. */
  undo(): void {
    this.travel(true);
  }

  redo(): void {
    this.travel(false);
  }

  private travel(back: boolean): void {
    const step = (back ? this.undos : this.redos).pop();
    if (!step) return;
    const side = back ? step.before : step.after;
    for (const target of step.targets) this.host.apply(target, step.name, side.live, step.prop);
    this.apply(step, side);
    (back ? this.redos : this.undos).push(step);
  }
}
