/**
 * What the editor does, apart from how it looks: a node as the TSX that made it, with each value
 * live, and every change — to the live object at once, kept as unsaved until Save writes each one
 * as one attribute of the `.tsx` file it came from, spliced by the dev server with everything else
 * byte for byte.
 *
 * Only what a scene file wrote is written back: a node's own element, a prefab's tag, the behaviours
 * on them. What a prefab is made of, what was spawned and what code made is changed live only.
 */
import type { Behaviour, EditHost, Reach, Source, Transform } from '@scenoco-three/core';
import type { Object3D } from 'three';

/** A value the editor can edit, by what it is live. */
export type Kind = 'number' | 'boolean' | 'string' | 'color' | 'vector' | 'angles' | 'option';

/** What the project's TypeScript declares a field or an argument to be: from the dev server. */
export type Field = { kind: Exclude<Kind, 'option'> } | { kind: 'option'; options: Option[] };

/** One of a few values a field takes, and how the file writes it: `"world"`, `{DoubleSide}`. */
export interface Option {
  label: string;
  value: string | number;
  text: string;
  /** A constant the file must import to write it. */
  import?: { name: string; from: string };
}

/** An element's class as declared: what its fields are, which are private, and its constructors. */
interface ElementTypes {
  element: number;
  fields: Record<string, Field>;
  hidden: string[];
  constructors: { name: string; field?: Field }[][];
}

/** One attribute, as a line of the TSX. */
export interface Attr {
  name: string;
  /** The value shown and edited: degrees for angles, `#rrggbb` for a colour. */
  value: unknown;
  /** Absent: shown as its source text, not edited. */
  kind?: Kind;
  /** For an `option`: the values it takes. */
  options?: Option[];
  /** Whether the element writes it. */
  written: boolean;
  /** The attribute's text in the file — `{[0, 1, 0]}`, `"wall"` — null for a bare flag. */
  text: string | null;
  /** Why a change stays live and is not written, when it is not. */
  liveOnly?: string;
  /** Changed since the last save: Save writes it. */
  unsaved: boolean;
  /** What the file says, as the editor shows it, when it writes a value the editor can compare. */
  file?: unknown;
  /**
   * What Reset puts back, only while the live value has moved away from it: what the file says, or —
   * for a change the file does not write — the value before the change.
   */
  source?: unknown;
  /** What it sets: the node, a behaviour, or — for a prop of a function's tag — the node it made. */
  target: object;
  /** Where a change is written: its element in its file. Absent for one that stays live, or is locked. */
  at?: Address;
  /** Shown, not edited: what a prefab is made of, outside prefab mode. */
  locked?: boolean;
  /** Every object the same element made — every copy of the prefab — takes a change. */
  wide?: boolean;
  /** The element, as `file:line:column`: what finds its other copies. */
  element?: string;
  /** One of the element's `args`, shown on its own line and named for the constructor's parameter. */
  arg?: ArgPlace;
  /** Each name in its text — `terrains`, `meadow` in `{terrains.meadow}` — and where it is declared. */
  links?: TextLink[];
}

/** A name in an attribute's text, `from` to `to`, and where the project declares it. */
export interface TextLink {
  from: number;
  to: number;
  where: Where;
}

/** Where an argument stands: its index, the list now, and the list's texts as the file writes them. */
export interface ArgPlace {
  index: number;
  now: Args;
  /** Each item's text when the page loaded: what a value put back is written as again. */
  original: string[];
  /** The whole attribute's text when the page loaded. */
  whole: string | null;
}

/** An element's arguments as they stand: the values the live object was made with, and their texts. */
interface Args {
  list: unknown[];
  items: string[];
}

/** What a tag is shown as: written into its file, live only and why, or locked; and whether every copy takes a change. */
interface Context {
  liveOnly?: string;
  locked?: boolean;
  wide?: boolean;
}

/** The prefab being edited in prefab mode, and how many copies of it the scene has. */
export interface Stage {
  root: Object3D;
  name: string;
  file: string;
  count: number;
}

/** One tag of the TSX: a node's element or a behaviour's. */
export interface Tag {
  name: string;
  attrs: Attr[];
  /** `Arena.tsx:37`, and where the code editor opens. */
  where?: Where;
}

/** A place in a project file. */
export interface Where {
  label: string;
  file: string;
  line: number;
  col: number;
}

/** How a source link opens: through the dev server — guessed, the system's app, the project's command — or an editor's own URL. */
export type CodeEditor = 'auto' | 'system' | 'custom' | 'vscode' | 'cursor';

export interface View {
  tag: Tag;
  /** What its element's children made and it holds — `<PlaneGeometry>`, `<Fog attach="fog">`. */
  attached: Tag[];
  behaviours: Tag[];
  /** Why nothing here is written, when nothing is. */
  note?: string;
  /** A prefab's copy: under its tag's overrides, what the prefab itself says — read-only here. */
  prefab?: { name: string; where?: Where; own: Tag; behaviours: Tag[]; root: Object3D };
  /** The prefab this node is a part of, to edit in prefab mode. */
  enter?: { root: Object3D; name: string };
}

interface ElementJson {
  tag: string;
  owner?: string;
  line: number;
  column: number;
  attributes: { name: string; text: string | null; items?: string[] }[];
}

interface FileJson {
  file: string;
  elements: ElementJson[];
}

/** Where an element is in its file: by index in document order, which an attribute edit never changes. */
interface Address {
  file: string;
  index: number;
}

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
  /** The attribute in its file — null for a change that stays live. */
  at: { key: string; address: Address } | null;
  before: Side;
  after: Side;
}

const TRANSFORM = ['position', 'rotation', 'scale'] as const;
/** How long a question the dev server could not answer waits before it is asked again. */
const RETRY_MS = 5000;
const CODE_EDITOR_KEY = 'scenoco-editor-code';
const REACH_KEY = 'scenoco-editor-reset';
const REACHES: readonly Reach[] = ['none', 'awake', 'onEnable', 'start', 'frame'];

export class Model {
  readonly host: EditHost;
  mode: 'translate' | 'rotate' | 'scale' = 'translate';
  status: { text: string; error: boolean } = { text: '', error: false };
  /** Called after something shown changed. */
  changed: () => void = () => {};
  private readonly files = new Map<string, Promise<FileJson>>();
  /** Each file's elements by where `jsxDEV` says they were written — the file as the page loaded it. */
  private readonly indexes = new Map<string, Map<string, number>>();
  private readonly tags = new Map<string, Map<string, string>>();
  private readonly owners = new Map<string, Map<string, string>>();
  private readonly undos: Step[] = [];
  private redos: Step[] = [];
  private readonly unsaved = new Map<string, Unsaved>();
  /** What each changed attribute's file says now, as written: saving moves it. */
  private readonly inFile = new Map<string, unknown>();
  /** Each unsaved attribute's value, as shown, before its first change: what Reset puts back when the file has none. */
  private readonly before = new Map<string, unknown>();
  /** Each file's elements as declared, by index, once the dev server answered. */
  private readonly types = new Map<string, Map<number, ElementTypes> | 'asking'>();
  /** Each file's links, by element index and attribute, once the dev server answered: TypeScript's own. */
  private readonly links = new Map<string, Map<string, TextLink[]> | 'asking'>();
  /** Each object's arguments since one was edited: until then, what its element gave. */
  private readonly args = new WeakMap<object, Args>();
  /** The project's scenes, which the editor can open: from the dev server. */
  scenes: { file: string; name: string }[] = [];
  private quiet: ReturnType<typeof setTimeout> | undefined;
  private custom: Promise<string | null> | undefined;

  constructor(host: EditHost) {
    this.host = host;
    call<{ file: string; name: string }[]>('GET', 'scenes').then(
      (scenes) => {
        this.scenes = scenes;
        this.changed();
      },
      () => {},
    );
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

  /**
   * The node as its TSX. A prefab's copy is two layers: its tag — this copy's overrides, in the
   * scene — and the prefab's own, read-only until prefab mode is entered (`enter`). In prefab mode
   * what the prefab is made of is written into its file, and every copy takes each change.
   */
  async view(node: Object3D): Promise<View> {
    const { host, stage } = this;
    const made = host.madeBy(node);
    const part = this.partOf(node);
    if (stage && !within(node, stage.root)) {
      return { ...(await this.plain(node, { locked: true })), note: `outside the prefab <${stage.name}> — ← Scene to edit the scene` };
    }
    if (part && part !== stage?.root) {
      const name = this.prefabName(part);
      return { ...(await this.plain(node, { locked: true })), note: `part of the prefab <${name}>`, enter: { root: part, name } };
    }
    const wide = !!stage;
    const liveOnly = !stage && host.spawned(node) ? 'spawned while the game ran' : undefined;
    if (stage && node === stage.root) {
      // The prefab's own root: its element in the prefab's file. Each copy's tag places and names it.
      const own = host.own(node) ?? {};
      const tag = await this.tagOf(node, own.source, own.given, { wide }, { fixed: 'each copy’s tag places it — change that in the scene' });
      return { tag, attached: await this.attached(node, { wide }), behaviours: await this.behaviours(node, { wide }) };
    }
    if (made?.prefab) {
      const own = host.own(node) ?? {};
      const tag = await this.tagOf(node, host.sourceOf(node), host.givenOf(node), { liveOnly, wide }, { props: made.props, name: this.tagName(node) });
      const ownTag = await this.tagOf(node, own.source, own.given, { locked: true }, { fixed: false });
      const prefab = { name: this.prefabName(node), where: own.source && where(own.source), own: ownTag, behaviours: await this.behaviours(node, { locked: true }), root: node };
      return { tag, attached: [], behaviours: [], prefab, note: liveOnly };
    }
    return { ...(await this.plain(node, { liveOnly, wide })), note: liveOnly };
  }

  /** A node that is neither a prefab's copy nor its root in prefab mode: its own element and behaviours. */
  private async plain(node: Object3D, ctx: Context): Promise<View> {
    const made = this.host.madeBy(node);
    const fixed = made && !made.prefab ? `<${this.tagName(node)}> is a plain component: its tag cannot place it` : undefined;
    const tag = await this.tagOf(node, this.host.sourceOf(node), this.host.givenOf(node), ctx, made ? { props: made.props, fixed } : {});
    return { tag, attached: made ? [] : await this.attached(node, ctx), behaviours: made ? [] : await this.behaviours(node, ctx) };
  }

  /** What the node holds that an element made — its geometry, its material, a scene's fog — as tags of their own. */
  private async attached(node: Object3D, ctx: Context): Promise<Tag[]> {
    const tags: Tag[] = [];
    for (const value of Object.values(node)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Object3D).isObject3D) continue;
      const source = this.host.sourceOf(value);
      if (source) tags.push(await this.tagOf(value, source, this.host.givenOf(value), ctx, { fixed: false }));
    }
    return tags;
  }

  /**
   * One element as a tag. `props`: a function's tag, whose props are its attributes. `fixed`: the
   * transform and name are not this element's to write — false leaves them out.
   */
  private async tagOf(
    node: object,
    source: Source | undefined,
    given: Readonly<Record<string, unknown>> | undefined,
    ctx: Context,
    how: { props?: Readonly<Record<string, unknown>>; fixed?: string | false; name?: string },
  ): Promise<Tag> {
    const address = source ? await this.addressFor(source) : null;
    const element = address ? await this.element(address) : undefined;
    const texts = new Map(element?.attributes.map((a) => [a.name, a.text]));
    const liveOnly = ctx.liveOnly ?? (ctx.locked || address ? undefined : source ? 'not found in its file' : 'made in code');
    const here = { ...ctx, liveOnly, from: source && sourceKey(source) };
    const attrs: Attr[] = [];
    if (how.fixed !== false) {
      const fixed = { ...here, liveOnly: here.liveOnly ?? how.fixed };
      const at = node as Object3D;
      if (at.name || texts.has('name')) attrs.push(this.attr(node, 'name', at.name, texts, given ?? {}, fixed, address));
      for (const name of TRANSFORM) attrs.push(this.attr(node, name, at[name], texts, given ?? {}, fixed, address));
    }
    if (how.props) {
      // A function's tag: its props, live as last passed. Changing one calls the function again.
      for (const [name, value] of Object.entries(how.props)) {
        if (name === 'children' || name === 'name' || (TRANSFORM as readonly string[]).includes(name)) continue;
        attrs.push(this.attr(node, name, value, texts, given ?? {}, here, address));
      }
    } else {
      // The element's own attributes past the transform, in the order written.
      for (const [name, text] of texts) {
        if (name === 'name' || (TRANSFORM as readonly string[]).includes(name)) continue;
        const items = element?.attributes.find((a) => a.name === name)?.items;
        if (name === 'args' && Array.isArray(given?.args)) attrs.push(...this.argAttrs(node, text, items, given.args, here, address));
        else attrs.push(this.attr(node, name, read(node, name), texts, given ?? {}, here, address, text));
      }
    }
    return { name: how.name ?? element?.tag ?? node.constructor.name, attrs, where: source && where(source) };
  }

  private behaviours(node: Object3D, ctx: Context): Promise<Tag[]> {
    return Promise.all(this.host.behavioursOn(node).map((b) => this.behaviour(b, ctx)));
  }

  private async behaviour(b: Behaviour, ctx: Context): Promise<Tag> {
    const source = this.host.sourceOf(b);
    const address = source ? await this.addressFor(source) : null;
    const element = address ? await this.element(address) : undefined;
    const texts = new Map(element?.attributes.map((a) => [a.name, a.text]));
    const given = this.host.givenOf(b) ?? {};
    const liveOnly = ctx.liveOnly ?? (ctx.locked || address ? undefined : source ? 'not found in its file' : 'added in code');
    const here = { ...ctx, liveOnly, from: source && sourceKey(source) };
    // What the class declares private is not the element's to set.
    const hidden = new Set(this.typesOf(address)?.hidden);
    const fields = Object.keys(b).filter((key) => !key.startsWith('_') && !key.startsWith('#') && !hidden.has(key));
    // Written attributes first, in the file's order; then the other fields, at their defaults.
    const order = [...texts.keys(), ...fields.filter((f) => !texts.has(f))];
    const attrs: Attr[] = [];
    for (const name of order) {
      const value = (b as unknown as Record<string, unknown>)[name];
      if (typeof value === 'function') continue;
      const attr = this.attr(b, name, value, texts, given, here, address);
      // An unwritten field only shows when it can be edited: a list or a reference has nothing to show.
      if (!attr.written && !attr.kind) continue;
      attrs.push(attr);
    }
    return { name: b.constructor.name, attrs, where: source && where(source) };
  }

  private attr(
    target: object,
    name: string,
    live: unknown,
    texts: Map<string, string | null>,
    given: Readonly<Record<string, unknown>>,
    ctx: Context & { from?: string },
    address: Address | null,
    text: string | null = texts.get(name) ?? null,
  ): Attr {
    const field = this.typesOf(address)?.fields[name];
    const kind = kindOf(live, name, field);
    const written = texts.has(name);
    const value = kind ? shown(live, kind) : live;
    const writes = !ctx.liveOnly && !ctx.locked && address ? address : undefined;
    const from = written && writes && kind && name in given ? asShown(given[name], kind, name, value, field) : undefined;
    const moved = from !== undefined && JSON.stringify(from) !== JSON.stringify(value);
    const unsaved = !!writes && this.unsaved.has(keyOf(writes, name));
    const back = moved ? from : unsaved ? this.before.get(keyOf(writes, name)) : undefined;
    return {
      name,
      value,
      kind,
      written,
      text,
      liveOnly: ctx.liveOnly,
      locked: ctx.locked,
      wide: ctx.wide && !!writes,
      element: ctx.from,
      at: writes,
      unsaved,
      file: from,
      source: back !== undefined && JSON.stringify(back) !== JSON.stringify(value) ? back : undefined,
      target,
      links: written && address ? this.linksOf(address, name) : undefined,
      ...(kind === 'option' && field?.kind === 'option' && { options: field.options }),
    };
  }

  /** An element's class as the project declares it; asked for once a file, in the background. */
  private typesOf(address: Address | null): ElementTypes | undefined {
    if (!address) return undefined;
    const known = this.types.get(address.file);
    if (known === undefined) {
      this.types.set(address.file, 'asking');
      call<ElementTypes[]>('GET', `types?file=${encodeURIComponent(address.file)}`).then(
        (list) => {
          this.types.set(address.file, new Map(list.map((t) => [t.element, t])));
          this.changed();
        },
        () => {
          // Nothing known for now; asked again in a while, not on every redraw.
          this.types.set(address.file, new Map());
          setTimeout(() => this.types.delete(address.file), RETRY_MS);
        },
      );
    }
    return known instanceof Map ? known.get(address.index) : undefined;
  }

  /** The names in an attribute's text, linked to where they are declared; asked for once a file, in the background. */
  private linksOf(address: Address, name: string): TextLink[] | undefined {
    const known = this.links.get(address.file);
    if (known === undefined) {
      this.links.set(address.file, 'asking');
      call<{ element: number; name: string; from: number; to: number; file: string; line: number; column: number }[]>('GET', `links?file=${encodeURIComponent(address.file)}`).then(
        (list) => {
          const byAttribute = new Map<string, TextLink[]>();
          for (const l of list) {
            const key = `${l.element}#${l.name}`;
            byAttribute.set(key, [...(byAttribute.get(key) ?? []), { from: l.from, to: l.to, where: { label: `${short(l.file)}:${l.line}`, file: l.file, line: l.line, col: l.column } }]);
          }
          this.links.set(address.file, byAttribute);
          this.changed();
        },
        () => {
          this.links.set(address.file, new Map());
          setTimeout(() => this.links.delete(address.file), RETRY_MS);
        },
      );
    }
    return known instanceof Map ? known.get(`${address.index}#${name}`) : undefined;
  }

  /**
   * `args={[…]}` as a line per argument, named for the constructor's parameter. One the live object
   * can take — the property it sets, or a geometry made again — and written as a value is editable;
   * the rest are shown as written.
   */
  private argAttrs(target: object, whole: string | null, items: string[] | undefined, given: unknown[], ctx: Context & { from?: string }, address: Address | null): Attr[] {
    const settable = this.host.parameters(target);
    // The constructor `args` fits: as many parameters as it gives, or the first that takes that many.
    const constructors = this.typesOf(address)?.constructors ?? [];
    const declared = constructors.find((c) => c.length === given.length) ?? constructors.find((c) => c.length >= given.length) ?? [];
    const writes = !ctx.liveOnly && !ctx.locked && address ? address : undefined;
    const now = this.args.get(this.host.current(target)) ?? { list: [...given], items: items ? [...items] : given.map(codeOf) };
    const unsaved = !!writes && this.unsaved.has(keyOf(writes, 'args'));
    return now.list.map((value, index) => {
      const name = declared[index]?.name ?? `arg${index}`;
      const field = declared[index]?.field;
      const own = kindOf(value, name, field);
      const kind = own && settable[index]?.settable && items?.length === given.length ? own : undefined;
      const first = kind ? shown(given[index], kind) : given[index];
      const shownValue = kind ? shown(value, kind) : value;
      const moved = kind !== undefined && JSON.stringify(first) !== JSON.stringify(shownValue);
      return {
        name,
        value: shownValue,
        kind,
        written: true,
        text: now.items[index] ?? codeOf(value),
        liveOnly: ctx.liveOnly,
        locked: ctx.locked,
        wide: ctx.wide && !!writes,
        element: ctx.from,
        at: writes,
        unsaved,
        file: first,
        source: moved ? first : undefined,
        target,
        arg: { index, now, original: items ?? [], whole },
        ...(kind === 'option' && field?.kind === 'option' && { options: field.options }),
      };
    });
  }

  /** The prefab copy a node is part of — the nearest one above it — or null. */
  private partOf(node: Object3D): Object3D | null {
    for (let up = node.parent; up; up = up.parent) if (this.host.madeBy(up)?.prefab) return up;
    return null;
  }

  /** A prefab's name: the constant its function is written in — `prefab(() => …)` has none of its own. */
  prefabName(root: Object3D): string {
    const own = this.host.own(root)?.source;
    const owner = own && this.ownerAt(own);
    return owner ?? (this.host.madeBy(root)?.name || this.tagName(root));
  }

  /** The prefab being edited, entered from one of its copies: what prefab mode writes into. */
  stage: Stage | null = null;
  /** Only the copy being edited is shown. */
  isolated = false;

  /** Prefab mode: what `root` is made of becomes editable, written into the prefab's file, for every copy. */
  enter(root: Object3D): void {
    const own = this.host.own(root)?.source;
    const made = this.host.madeBy(root);
    if (!own || !made) return;
    let count = 0;
    this.host.scene.traverse((n) => void (this.host.madeBy(n)?.fn === made.fn && count++));
    this.stage = { root, name: this.prefabName(root), file: own.fileName, count };
    this.host.select(root);
    this.changed();
  }

  /** Back to the scene. */
  leave(): void {
    const root = this.stage?.root ?? null;
    this.stage = null;
    this.isolate(false);
    if (root) this.host.select(root);
    this.changed();
  }

  isolate(on: boolean): void {
    this.isolated = on && !!this.stage;
    this.host.isolate(this.isolated ? this.stage!.root : null);
    this.changed();
  }

  /** Everything an element made: one object, or — for a change made prefab-wide — every copy's. */
  private targets(attr: { target: object; wide?: boolean; element?: string }): object[] {
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
    const live = toLive(value, attr.kind);
    const targets = this.targets(attr);
    for (const target of targets) this.host.apply(target, attr.name, live);
    if (!done) return this.changed();
    const at = this.at(attr);
    const was = at && (this.unsaved.get(at.key)?.file ?? this.inFile.get(at.key));
    if (at && !this.unsaved.has(at.key)) this.before.set(at.key, before);
    // An option is written as the file names it — `{DoubleSide}`, imported if need be.
    const option = attr.options?.find((o) => o.value === value);
    const file = option ? new Text(option.text, option.import) : toFile(value, attr.kind);
    this.record({ targets, name: attr.name, at, before: { live: toLive(before, attr.kind), file: was }, after: { live, file } });
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
    for (const target of targets) this.host.apply(target, attr.name, live);
    this.record({ targets, name: attr.name, at, before: { live: toLive(attr.value, attr.kind), file: was }, after: { live, file } });
  }

  /** Write every unsaved change into its file, one attribute each. */
  async save(): Promise<void> {
    let saved = 0;
    for (const [key, change] of [...this.unsaved]) {
      const { file } = change;
      const ok = await this.write(change.address, change.name, file === UNWRITTEN ? null : file instanceof Text ? { text: file.text, ...(file.import && { import: file.import }) } : { value: file });
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

  /** What the gizmo does: focusing position, rotation or scale picks it too. */
  setMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.mode = mode;
    this.host.setMode(mode);
  }

  /** The gizmo let go: write what it moved. */
  async moved(node: Object3D, before: Transform): Promise<void> {
    const name = ({ translate: 'position', rotate: 'rotation', scale: 'scale' } as const)[this.mode];
    const view = await this.view(node);
    const attr = view.tag.attrs.find((a) => a.name === name);
    if (attr?.kind) await this.set(attr, attr.value, true, shown(before[name], attr.kind));
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
    for (const target of step.targets) this.host.apply(target, step.name, side.live);
    this.apply(step, side);
    (back ? this.redos : this.undos).push(step);
  }

  /** One attribute written, or (null) taken out; false when the server refused, which the status line then says. */
  private async write(address: Address, name: string, what: { value: unknown } | { text: string | null } | null): Promise<boolean> {
    try {
      const element = await this.element(address);
      if (!element) throw new Error('the element is gone from its file');
      const body = { file: address.file, index: address.index, expect: { tag: element.tag, line: element.line, column: element.column }, name, ...what };
      this.files.set(address.file, Promise.resolve(await call<FileJson>('POST', what ? 'set' : 'remove', body)));
      // The file moved under its links: they are asked for again.
      this.links.delete(address.file);
      return true;
    } catch (error) {
      this.say(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  /** How source links open: this browser's choice, kept. */
  get codeEditor(): CodeEditor {
    try {
      const saved = localStorage.getItem(CODE_EDITOR_KEY);
      if (saved === 'auto' || saved === 'system' || saved === 'custom' || saved === 'vscode' || saved === 'cursor') return saved;
    } catch {
      // no storage: the default
    }
    return 'auto';
  }

  set codeEditor(how: CodeEditor) {
    try {
      localStorage.setItem(CODE_EDITOR_KEY, how);
    } catch {
      // no storage: it lasts as long as nothing asks again
    }
    this.changed();
  }

  /** How far Reset lets behaviours go before it holds the scene: this browser's choice, kept. */
  get resetReach(): Reach {
    try {
      const saved = localStorage.getItem(REACH_KEY) as Reach | null;
      if (saved && REACHES.includes(saved)) return saved;
    } catch {
      // no storage: the default
    }
    return 'frame';
  }

  set resetReach(reach: Reach) {
    try {
      localStorage.setItem(REACH_KEY, reach);
    } catch {
      // no storage: it lasts as long as nothing asks again
    }
    this.changed();
  }

  /** The command the project set for opening files, read once: null when it set none. */
  customCommand(): Promise<string | null> {
    this.custom ??= call<{ custom: string | null }>('GET', 'open').then((a) => a.custom, () => null);
    return this.custom;
  }

  /** Open a place in the code editor the settings name. */
  async open(at: Where): Promise<void> {
    const how = this.codeEditor;
    if (how === 'vscode' || how === 'cursor') {
      // The editor's own URL: the browser hands it over, asking the first time.
      const link = document.createElement('a');
      link.href = `${how}://file${encodeURI(at.file)}:${at.line}:${at.col}`;
      link.click();
      return this.say(`Opening ${at.label} in ${how === 'vscode' ? 'VS Code' : 'Cursor'}…`);
    }
    try {
      await call('POST', 'open', { file: at.file, line: at.line, col: at.col, how });
      this.say(`Opened ${at.label}.`);
    } catch (error) {
      this.say(`Could not open ${at.label}: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  /** A line under the toolbar: an error stays until the next, anything else goes after a moment. */
  say(text: string, error = false): void {
    this.status = { text, error };
    clearTimeout(this.quiet);
    if (text && !error) this.quiet = setTimeout(() => this.say(''), 3000);
    this.changed();
  }

  /**
   * What a node's tag says: `<Bridge>` for what a function's tag made — a prefab's function has no
   * name of its own, `prefab(() => …)`, so it is read from the file — and the class for the rest.
   */
  tagName(node: Object3D): string {
    const made = this.host.madeBy(node);
    if (!made) return node.constructor.name;
    // A spawned copy has no tag to read: its prefab's name is.
    if (this.host.spawned(node) && made.prefab && !this.host.spawned(node.parent ?? node)) {
      // Not `prefabName`: it falls back here while the prefab's file is still being read.
      const own = this.host.own(node)?.source;
      return (own && this.ownerAt(own)) || made.name || node.name || node.type;
    }
    const source = this.host.sourceOf(node);
    if (source) {
      const tags = this.tags.get(source.fileName);
      const known = tags?.get(`${source.lineNumber}:${source.columnNumber}`);
      if (known) return known;
      // Read once; when it comes, the interface asks again.
      if (!tags && !this.files.has(source.fileName)) void this.read(source.fileName).then(() => this.changed(), () => {});
    }
    return made.name || node.name || node.type;
  }

  /** The constant an element is written in, once its file is read; asking reads it. */
  private ownerAt(source: Source): string | undefined {
    const owners = this.owners.get(source.fileName);
    if (!owners && !this.files.has(source.fileName)) void this.read(source.fileName).then(() => this.changed(), () => {});
    return owners?.get(`${source.lineNumber}:${source.columnNumber}`);
  }

  private async addressFor(source: Source): Promise<Address | null> {
    await this.read(source.fileName);
    const index = this.indexes.get(source.fileName)?.get(`${source.lineNumber}:${source.columnNumber}`);
    return index === undefined ? null : { file: source.fileName, index };
  }

  private async element(address: Address): Promise<ElementJson | undefined> {
    return (await this.read(address.file)).elements[address.index];
  }

  private read(file: string): Promise<FileJson> {
    let doc = this.files.get(file);
    if (!doc) {
      doc = call<FileJson>('GET', `scene?file=${encodeURIComponent(file)}`).then((json) => {
        // Where each element was when the page loaded: what every later `sourceOf` reports.
        if (!this.indexes.has(file)) {
          this.indexes.set(file, new Map(json.elements.map((e, i) => [`${e.line}:${e.column}`, i])));
          this.tags.set(file, new Map(json.elements.map((e) => [`${e.line}:${e.column}`, e.tag])));
          this.owners.set(file, new Map(json.elements.flatMap((e) => (e.owner ? [[`${e.line}:${e.column}`, e.owner] as const] : []))));
        }
        return json;
      });
      this.files.set(file, doc);
      doc.catch(() => this.files.delete(file));
    }
    return doc;
  }
}

/**
 * What an editable value is: as the project declares it when the dev server has said — a colour,
 * one of a few options — and otherwise from the value itself.
 */
export function kindOf(value: unknown, name: string, field?: Field): Kind | undefined {
  if (field && fits(value, field.kind)) return field.kind;
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.isColor) return 'color';
  if (v.isEuler || (name === 'rotation' && Array.isArray(value))) return 'angles';
  if (v.isVector2 || v.isVector3 || v.isVector4) return 'vector';
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every((x) => typeof x === 'number')) return 'vector';
  return undefined;
}

/** Whether a live value can be edited as the kind its field is declared. */
function fits(value: unknown, kind: Kind): boolean {
  const v = value as Record<string, unknown> | null;
  switch (kind) {
    case 'color':
      return typeof value === 'string' ? /^#[0-9a-f]{6}$/i.test(value) : !!v?.isColor;
    case 'option':
      return typeof value === 'string' || typeof value === 'number';
    case 'number':
    case 'boolean':
    case 'string':
      return typeof value === kind;
    default:
      return kindOf(value, kind === 'angles' ? 'rotation' : '') === kind;
  }
}

/** The value as the editor shows it. */
function shown(value: unknown, kind: Kind): unknown {
  const v = value as Record<string, unknown> & { toArray?: () => unknown[]; getHexString?: () => string };
  if (kind === 'color') return typeof value === 'string' ? value : `#${v.getHexString!()}`;
  if (kind === 'angles') return (Array.isArray(value) ? value : v.toArray!()).slice(0, 3).map((r) => round((Number(r) * 180) / Math.PI));
  if (kind === 'vector') return (Array.isArray(value) ? value : v.toArray!()).map((x) => round(Number(x)));
  if (kind === 'number') return round(value as number);
  return value;
}

/**
 * A value as written, in the units the editor shows the live one in — undefined when the two cannot
 * be compared: `scale={0.25}` is `[0.25, 0.25, 0.25]`, a colour is lower-case `#rrggbb`.
 */
function asShown(written: unknown, kind: Kind, name: string, live: unknown, field?: Field): unknown {
  if (typeof written === 'number' && kind === 'vector') return (live as number[]).map(() => round(written));
  const own = kindOf(written, name, field);
  if (!own || (own !== kind && !(own === 'string' && kind === 'color'))) return undefined;
  const value = shown(written, kind === 'color' ? 'color' : own);
  return typeof value === 'string' && kind === 'color' ? value.toLowerCase() : value;
}

/** What the live object takes: radians for angles. */
function toLive(value: unknown, kind: Kind | undefined): unknown {
  if (kind === 'angles') return (value as number[]).map((d) => (d * Math.PI) / 180);
  return value;
}

/** What the file is written with: radians for angles, four decimals. */
function toFile(value: unknown, kind: Kind | undefined): unknown {
  if (kind === 'angles') return (value as number[]).map((d) => round((d * Math.PI) / 180, 4));
  if (kind === 'vector') return (value as number[]).map((x) => round(x, 4));
  if (kind === 'number') return round(value as number, 4);
  return value;
}

/** A new item of a list, written like the one it replaces: a string keeps its quotes. */
function itemText(value: unknown, was: string | undefined): string {
  if (typeof value === 'string') {
    const quote = was?.startsWith("'") ? "'" : '"';
    return `${quote}${value.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`;
  }
  return codeOf(value);
}

/** A dashed name walks in: `shadow-mapSize` is `shadow.mapSize`. */
function read(target: object, name: string): unknown {
  if (name in target) return (target as Record<string, unknown>)[name];
  let value: unknown = target;
  for (const step of name.split('-')) value = (value as Record<string, unknown> | undefined)?.[step];
  return value;
}

export function codeOf(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(codeOf).join(', ')}]`;
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function where(source: Source): Where {
  return { label: `${short(source.fileName)}:${source.lineNumber}`, file: source.fileName, line: source.lineNumber, col: source.columnNumber };
}

function same(a: unknown, b: unknown): boolean {
  return a === b || (typeof a !== 'symbol' && typeof b !== 'symbol' && JSON.stringify(a) === JSON.stringify(b));
}

function sourceKey(source: Source | undefined): string | undefined {
  return source && `${source.fileName}:${source.lineNumber}:${source.columnNumber}`;
}

function within(node: Object3D, root: Object3D): boolean {
  for (let n: Object3D | null = node; n; n = n.parent) if (n === root) return true;
  return false;
}

function keyOf(address: Address, name: string): string {
  return `${address.file}#${address.index}#${name}`;
}

function short(file: string): string {
  return file.split('/').pop() ?? file;
}

function round(x: number, places = 3): number {
  const k = 10 ** places;
  return Math.round(x * k) / k;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const res = await fetch(`/__scenoco/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return json;
}
